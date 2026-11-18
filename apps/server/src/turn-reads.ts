import fs from 'node:fs/promises';
import path from 'node:path';

interface PersistedReads {
  version: 1;
  reads: Record<string, string>;
}

/**
 * Persistenza dei turni già letti, condivisa tra browser e dispositivi.
 *
 * Il file contiene solo la mappa sessionId -> turnId: nessun contenuto della
 * conversazione. Il localStorage del browser resta un fallback ottimistico.
 */
export class TurnReadStore {
  private readonly filePath: string;
  private reads: Record<string, string> = {};
  private chain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'config', 'turn-reads.json');
  }

  async load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      const value = parsed as Partial<PersistedReads>;
      if (value.version !== 1 || !value.reads || typeof value.reads !== 'object' || Array.isArray(value.reads)) return;
      const reads: Record<string, string> = {};
      for (const [sessionId, turnId] of Object.entries(value.reads)) {
        if (isId(sessionId) && isId(turnId)) reads[sessionId] = turnId;
      }
      this.reads = reads;
    } catch {
      // Un file assente o corrotto non deve impedire l'avvio.
    }
  }

  getAll(): Record<string, string> {
    return { ...this.reads };
  }

  get(sessionId: string): string | null {
    return this.reads[sessionId] ?? null;
  }

  async mark(sessionId: string, turnId: string): Promise<void> {
    if (!isId(sessionId) || !isId(turnId) || this.reads[sessionId] === turnId) return;
    this.reads[sessionId] = turnId;
    const snapshot = { ...this.reads };
    this.chain = this.chain.then(() => this.persist(snapshot)).catch(() => undefined);
    await this.chain;
  }

  private async persist(snapshot: Record<string, string>): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temp, `${JSON.stringify({ version: 1, reads: snapshot }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, this.filePath);
  }
}

function isId(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !value.includes('\0') && !value.includes('/') && !value.includes('\\');
}
