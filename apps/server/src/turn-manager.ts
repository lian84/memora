import { randomUUID } from 'node:crypto';
import type { ChatAttachmentContext, StreamEvent } from '@memora/shared';

export type TurnStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted';

export interface TurnInfo {
  turnId: string;
  sessionId: string;
  status: TurnStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
  firstSeq: number;
  lastSeq: number;
}

interface Turn extends TurnInfo {
  text: string;
  attachments: ChatAttachmentContext[];
  events: Array<{ seq: number; event: StreamEvent }>;
  subscribers: Set<(event: { seq: number; event: StreamEvent }) => void>;
  abortRequested: boolean;
  controller?: Promise<unknown>;
}

export interface TurnAgentService {
  sendMessage(
    sessionId: string,
    text: string,
    onEvent: (event: StreamEvent) => void,
    attachments?: ChatAttachmentContext[],
  ): Promise<unknown>;
  abort(sessionId: string): Promise<unknown>;
}

interface TurnManagerOptions {
  maxConcurrent?: number;
  maxBufferedEvents?: number;
  agentService: TurnAgentService;
}

/**
 * Esegue i turni indipendentemente dalla connessione del browser.
 *
 * Le sessioni diverse possono procedere in parallelo; una sessione ha un solo
 * turno attivo e i successivi vengono accodati. Il client si limita a
 * sottoscrivere gli eventi e può riconnettersi con `after`.
 */
export class TurnManager {
  private readonly maxConcurrent: number;
  private readonly maxBufferedEvents: number;
  private readonly agentService: TurnAgentService;
  private readonly turns = new Map<string, Turn>();
  private readonly latestBySession = new Map<string, string>();
  private readonly queue: string[] = [];
  private readonly activeBySession = new Set<string>();
  private activeCount = 0;

  constructor(options: TurnManagerOptions) {
    this.agentService = options.agentService;
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 2);
    this.maxBufferedEvents = Math.max(50, options.maxBufferedEvents ?? 2000);
  }

  start(sessionId: string, text: string, attachments: ChatAttachmentContext[] = []): TurnInfo {
    const turn: Turn = {
      turnId: `turn-${randomUUID()}`,
      sessionId,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      firstSeq: 1,
      lastSeq: 0,
      text,
      attachments,
      events: [],
      subscribers: new Set(),
      abortRequested: false,
    };
    this.turns.set(turn.turnId, turn);
    this.latestBySession.set(sessionId, turn.turnId);
    this.queue.push(turn.turnId);
    this.append(turn, {
      type: 'turn_status',
      sessionId,
      timestamp: Date.now(),
      payload: { turnId: turn.turnId, status: 'queued' },
    });
    this.schedule();
    return this.toInfo(turn);
  }

  getTurn(turnId: string): TurnInfo | null {
    const turn = this.turns.get(turnId);
    return turn ? this.toInfo(turn) : null;
  }

  getCurrent(sessionId: string): TurnInfo | null {
    const turnId = this.latestBySession.get(sessionId);
    return turnId ? this.getTurn(turnId) : null;
  }

  list(): TurnInfo[] {
    return [...this.turns.values()].map(turn => this.toInfo(turn));
  }

  subscribe(
    turnId: string,
    after: number,
    listener: (event: { seq: number; event: StreamEvent }) => void,
  ): (() => void) | null {
    const turn = this.turns.get(turnId);
    if (!turn) return null;
    for (const entry of turn.events) {
      if (entry.seq > after) listener(entry);
    }
    if (turn.status === 'completed' || turn.status === 'failed' || turn.status === 'aborted') return () => {};
    turn.subscribers.add(listener);
    return () => turn.subscribers.delete(listener);
  }

  async abortSession(sessionId: string): Promise<TurnInfo | null> {
    const current = this.getCurrent(sessionId);
    return current ? this.abort(current.turnId) : null;
  }

  async abort(turnId: string): Promise<TurnInfo | null> {
    const turn = this.turns.get(turnId);
    if (!turn) return null;
    if (turn.status === 'queued') {
      const index = this.queue.indexOf(turnId);
      if (index >= 0) this.queue.splice(index, 1);
      this.finish(turn, 'aborted');
      return this.toInfo(turn);
    }
    if (turn.status !== 'running') return this.toInfo(turn);
    turn.abortRequested = true;
    try {
      await this.agentService.abort(turn.sessionId);
    } catch {
      // Il turno verrà comunque marcato interrotto se l'abort non è disponibile.
    }
    return this.toInfo(turn);
  }

  private toInfo(turn: Turn): TurnInfo {
    return {
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      status: turn.status,
      createdAt: turn.createdAt,
      updatedAt: turn.updatedAt,
      ...(turn.error ? { error: turn.error } : {}),
      firstSeq: turn.firstSeq,
      lastSeq: turn.lastSeq,
    };
  }

  private append(turn: Turn, event: StreamEvent): void {
    const seq = ++turn.lastSeq;
    turn.events.push({ seq, event });
    if (turn.events.length > this.maxBufferedEvents) {
      const removed = turn.events.splice(0, turn.events.length - this.maxBufferedEvents);
      turn.firstSeq += removed.length;
    }
    turn.updatedAt = Date.now();
    for (const subscriber of turn.subscribers) subscriber({ seq, event });
  }

  private setStatus(turn: Turn, status: TurnStatus, error?: string): void {
    turn.status = status;
    if (error) turn.error = error;
    this.append(turn, {
      type: 'turn_status',
      sessionId: turn.sessionId,
      timestamp: Date.now(),
      payload: { turnId: turn.turnId, status, ...(error ? { error } : {}) },
    });
  }

  private finish(turn: Turn, status: 'completed' | 'failed' | 'aborted', error?: string): void {
    if (turn.abortRequested && status === 'completed') status = 'aborted';
    this.setStatus(turn, status, error);
    this.append(turn, {
      type: 'turn_complete',
      sessionId: turn.sessionId,
      timestamp: Date.now(),
      payload: { turnId: turn.turnId, status, ...(error ? { error } : {}) },
    });
  }

  private schedule(): void {
    while (this.activeCount < this.maxConcurrent) {
      const index = this.queue.findIndex(turnId => {
        const turn = this.turns.get(turnId);
        return !!turn && !this.activeBySession.has(turn.sessionId);
      });
      if (index < 0) return;
      const [turnId] = this.queue.splice(index, 1);
      const turn = turnId ? this.turns.get(turnId) : undefined;
      if (!turn) continue;
      void this.run(turn);
    }
  }

  private async run(turn: Turn): Promise<void> {
    this.activeBySession.add(turn.sessionId);
    this.activeCount++;
    this.setStatus(turn, 'running');
    try {
      const result = await this.agentService.sendMessage(
        turn.sessionId,
        turn.text,
        event => this.append(turn, event),
        turn.attachments,
      );
      if (result && typeof result === 'object') {
        const value = result as { sourcesUsed?: unknown; memoryCandidatesCreated?: unknown };
        if (Array.isArray(value.sourcesUsed) && value.sourcesUsed.length > 0) {
          this.append(turn, { type: 'memory_sources', sessionId: turn.sessionId, timestamp: Date.now(), payload: value.sourcesUsed });
        }
        if (Array.isArray(value.memoryCandidatesCreated) && value.memoryCandidatesCreated.length > 0) {
          this.append(turn, {
            type: 'memory_candidates',
            sessionId: turn.sessionId,
            timestamp: Date.now(),
            payload: value.memoryCandidatesCreated.map(candidate => {
              const item = candidate as { id?: unknown; status?: unknown; targetPath?: unknown; project?: unknown; category?: unknown };
              return { id: item.id, status: item.status, targetPath: item.targetPath, project: item.project, category: item.category };
            }),
          });
        }
      }
      this.finish(turn, turn.abortRequested ? 'aborted' : 'completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.append(turn, { type: 'error', sessionId: turn.sessionId, timestamp: Date.now(), payload: message });
      this.finish(turn, turn.abortRequested ? 'aborted' : 'failed', message);
    } finally {
      this.activeBySession.delete(turn.sessionId);
      this.activeCount--;
      this.schedule();
    }
  }
}
