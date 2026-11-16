import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemoryCandidate } from '@memora/shared';

/**
 * Archivio append-only dei candidati memoria.
 *
 * Ogni riga è una versione completa del candidato. L'ultima versione per ID
 * rappresenta lo stato corrente; le versioni precedenti restano come audit
 * minimale. Il file JSONL non è indicizzato dal Second Brain.
 */
export class MemoryCandidateStore {
  private readonly inboxDir: string;
  readonly filePath: string;

  constructor(dataDir: string) {
    this.inboxDir = path.join(dataDir, 'memory-inbox');
    this.filePath = path.join(this.inboxDir, 'candidates.jsonl');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.inboxDir, { recursive: true });
  }

  async append(candidate: MemoryCandidate): Promise<void> {
    await this.initialize();
    await fs.appendFile(this.filePath, `${JSON.stringify(candidate)}\n`, { mode: 0o600 });
  }

  async listAll(): Promise<MemoryCandidate[]> {
    let content: string;
    try {
      content = await fs.readFile(this.filePath, 'utf-8');
    } catch {
      return [];
    }

    const latestById = new Map<string, MemoryCandidate>();
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Partial<MemoryCandidate>;
        if (typeof parsed.id !== 'string' || typeof parsed.status !== 'string') continue;
        latestById.set(parsed.id, parsed as MemoryCandidate);
      } catch {
        // Una riga corrotta non deve rendere illeggibile tutto l'archivio.
      }
    }

    return [...latestById.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id: string): Promise<MemoryCandidate | null> {
    const candidates = await this.listAll();
    return candidates.find((candidate) => candidate.id === id) ?? null;
  }
}
