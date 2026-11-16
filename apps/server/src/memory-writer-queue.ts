import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemoryTurnInput, MemoryWriterLike } from '@memora/shared';

type QueueEvent = 'queued' | 'started' | 'completed' | 'failed' | 'rejected';
type QueueStatus = 'queued' | 'running' | 'completed' | 'failed';

interface QueueEntry {
  id: string;
  idempotencyKey: string;
  input: MemoryTurnInput;
  status: QueueStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt: number;
  errorCode?: string;
}

export interface MemoryWriterQueueOptions {
  dataDir?: string;
  maxPending?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  now?: () => number;
  idFactory?: () => string;
}

export interface MemoryWriterQueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  attempts: number;
  oldestQueuedAgeMs: number | null;
  lastCompletedAt: number | null;
  lastFailedAt: number | null;
}

/** Coda seriale con persistenza opzionale, idempotenza, retry e recupero. */
export class MemoryWriterQueue implements MemoryWriterLike {
  private readonly pending: QueueEntry[] = [];
  private readonly entries = new Map<string, QueueEntry>();
  private readonly dataDir?: string;
  private readonly filePath?: string;
  private readonly maxPending: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private scheduled = false;
  private running = false;
  private closing = false;
  private timer: NodeJS.Timeout | undefined;
  private waiters: Array<() => void> = [];
  private runWaiters: Array<() => void> = [];

  constructor(
    private readonly writer: MemoryWriterLike,
    private readonly log: (event: QueueEvent, depth: number) => void,
    options: number | MemoryWriterQueueOptions = 100,
  ) {
    const config = typeof options === 'number' ? { maxPending: options } : options;
    this.maxPending = config.maxPending ?? 100;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 5_000;
    this.now = config.now ?? Date.now;
    this.idFactory = config.idFactory ?? crypto.randomUUID;
    if (config.dataDir) {
      this.dataDir = path.join(config.dataDir, 'memory-inbox');
      this.filePath = path.join(this.dataDir, 'writer-queue.jsonl');
    }
  }

  /** Carica e riprende i job persistiti. No-op per la coda volatile. */
  async initialize(): Promise<void> {
    if (!this.filePath) return;
    await fs.mkdir(this.dataDir!, { recursive: true, mode: 0o700 });
    let content = '';
    try {
      content = await fs.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as QueueEntry;
        if (!entry.id || !entry.input || !entry.status) continue;
        this.entries.set(entry.id, entry);
      } catch {
        // Una riga corrotta non deve bloccare la ripresa.
      }
    }
    for (const entry of this.entries.values()) {
      if (entry.status === 'running') {
        entry.status = entry.attempts < this.maxAttempts ? 'queued' : 'failed';
        entry.updatedAt = this.now();
        entry.nextAttemptAt = this.now();
        await this.persist(entry);
      }
      if (entry.status === 'queued') this.pending.push(entry);
    }
    this.pending.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.createdAt - b.createdAt);
    this.schedule();
  }

  get queueLength(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  getStats(): MemoryWriterQueueStats {
    const values = [...this.entries.values()];
    return {
      queued: values.filter(entry => entry.status === 'queued').length,
      running: values.filter(entry => entry.status === 'running').length,
      completed: values.filter(entry => entry.status === 'completed').length,
      failed: values.filter(entry => entry.status === 'failed').length,
      attempts: values.reduce((sum, entry) => sum + entry.attempts, 0),
      oldestQueuedAgeMs: values.filter(entry => entry.status === 'queued').length === 0
        ? null
        : this.now() - Math.min(...values.filter(entry => entry.status === 'queued').map(entry => entry.createdAt)),
      lastCompletedAt: values.filter(entry => entry.status === 'completed').reduce<number | null>((latest, entry) => latest === null || entry.updatedAt > latest ? entry.updatedAt : latest, null),
      lastFailedAt: values.filter(entry => entry.status === 'failed').reduce<number | null>((latest, entry) => latest === null || entry.updatedAt > latest ? entry.updatedAt : latest, null),
    };
  }

  async processTurn(input: MemoryTurnInput): Promise<{ created: [] }> {
    if (this.closing || this.pending.length >= this.maxPending) {
      this.log('rejected', this.pending.length);
      return { created: [] };
    }
    const idempotencyKey = this.idempotencyKey(input);
    const duplicate = [...this.entries.values()].some(entry =>
      entry.idempotencyKey === idempotencyKey && (entry.status === 'queued' || entry.status === 'running' || entry.status === 'completed'));
    if (duplicate) {
      this.log('rejected', this.pending.length);
      return { created: [] };
    }
    const now = this.now();
    const entry: QueueEntry = {
      id: this.idFactory(),
      idempotencyKey,
      input,
      status: 'queued',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
    };
    this.entries.set(entry.id, entry);
    this.pending.push(entry);
    await this.persist(entry);
    this.log('queued', this.pending.length);
    this.schedule();
    return { created: [] };
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.filePath) {
      if (!this.running) return;
      await new Promise<void>(resolve => this.runWaiters.push(resolve));
      return;
    }
    if (this.running) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
      return;
    }
    if (this.pending.length > 0) {
      this.scheduled = false;
      await this.run();
    }
  }

  /** Attende che la coda sia completamente inattiva (utile a test e shutdown). */
  async waitForIdle(): Promise<void> {
    if (!this.running && !this.scheduled && this.pending.length === 0) return;
    await new Promise<void>(resolve => this.waiters.push(resolve));
  }

  private idempotencyKey(input: MemoryTurnInput): string {
    if (input.turnId) return `turn:${input.turnId}`;
    if (input.sourceMessageId) return `message:${input.sessionId}:${input.sourceMessageId}`;
    return `text:${input.sessionId}:${crypto.createHash('sha256').update(input.userText).digest('hex')}`;
  }

  private schedule(): void {
    if (this.running || this.scheduled || this.pending.length === 0 || this.closing) return;
    this.scheduled = true;
    const next = this.pending[0]!;
    const delay = Math.max(25, next.nextAttemptAt - this.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.scheduled = false;
      void this.run();
    }, delay);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length > 0) {
        if (this.closing && this.filePath) break;
        const entry = this.pending.shift()!;
        if (entry.status !== 'queued') continue;
        entry.status = 'running';
        entry.attempts++;
        entry.updatedAt = this.now();
        await this.persist(entry);
        this.log('started', this.pending.length);
        try {
          await this.writer.processTurn(entry.input);
          entry.status = 'completed';
          entry.updatedAt = this.now();
          await this.persist(entry);
          this.log('completed', this.pending.length);
        } catch {
          entry.errorCode = 'writer_failed';
          entry.updatedAt = this.now();
          if (entry.attempts < this.maxAttempts) {
            entry.status = 'queued';
            entry.nextAttemptAt = this.now() + this.retryDelayMs * entry.attempts;
            await this.persist(entry);
            this.pending.push(entry);
            this.pending.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.createdAt - b.createdAt);
            this.log('failed', this.pending.length);
          } else {
            entry.status = 'failed';
            await this.persist(entry);
            this.log('failed', this.pending.length);
          }
        }
      }
    } finally {
      this.running = false;
      if (!this.closing) this.schedule();
      if (!this.running && !this.scheduled && this.pending.length === 0) {
        for (const resolve of this.waiters.splice(0)) resolve();
      }
      for (const resolve of this.runWaiters.splice(0)) resolve();
    }
  }

  private async persist(entry: QueueEntry): Promise<void> {
    if (!this.filePath) return;
    await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  }
}
