import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { DataExportRecord, DataExportStatus } from '@memora/shared';

const EXPORT_ROOTS = ['memory', 'projects', 'agents', 'automations', 'memory-inbox', 'artifacts', 'chat-attachments', 'pi-sessions'];
const ID_PATTERN = /^memora-export-[a-zA-Z0-9-]+$/;

export class DataExportError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'DataExportError';
  }
}

export interface DataExportServiceOptions {
  dataDir: string;
  appVersion: string;
  env?: NodeJS.ProcessEnv;
  log?: (event: string, details?: Record<string, unknown>) => void;
}

async function runTar(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new DataExportError('export_failed', stderr.trim().slice(0, 500) || `tar exit ${code}`, 500)));
  });
}

/** Esportazione leggibile e non cifrata, senza configurazione o segreti. */
export class DataExportService {
  readonly exportDir: string;
  private readonly dataDir: string;
  private readonly appVersion: string;
  private readonly log: (event: string, details?: Record<string, unknown>) => void;

  constructor(options: DataExportServiceOptions) {
    this.dataDir = options.dataDir;
    this.appVersion = options.appVersion;
    this.exportDir = path.resolve(options.env?.MEMORA_EXPORT_DIR ?? path.join(options.dataDir, '..', 'memora-exports'));
    this.log = options.log ?? (() => undefined);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.exportDir, { recursive: true, mode: 0o700 });
  }

  async getStatus(): Promise<DataExportStatus> {
    await this.initialize();
    return { localDir: this.exportDir, exports: await this.list() };
  }

  async create(): Promise<DataExportRecord> {
    await this.initialize();
    const date = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const id = `memora-export-${date}-${Math.random().toString(16).slice(2, 10)}`;
    const filename = `${id}.tar.gz`;
    const archive = path.join(this.exportDir, filename);
    const manifestPath = path.join(this.exportDir, `${id}.manifest.json`);
    const temporaryDir = await fs.mkdtemp(path.join(this.exportDir, '.export-'));
    const temporaryManifest = path.join(temporaryDir, 'export-manifest.json');
    const existingRoots: string[] = [];
    for (const root of EXPORT_ROOTS) {
      try { if ((await fs.stat(path.join(this.dataDir, root))).isDirectory()) existingRoots.push(root); } catch { /* assente */ }
    }
    const manifest = {
      format: 'memora-export',
      version: 1,
      createdAt: Date.now(),
      appVersion: this.appVersion,
      roots: existingRoots,
      excluded: ['config', 'secrets', 'index', 'models', 'browser-libs', 'searxng', 'runtime', 'backups', 'tools', '.trash'],
      note: 'Export leggibile senza configurazione, credenziali o segreti.',
    };
    try {
      await fs.writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      const args = ['-czf', archive, '-C', this.dataDir];
      for (const root of existingRoots) args.push(root);
      args.push('-C', temporaryDir, path.basename(temporaryManifest));
      await runTar(args);
      await fs.chmod(archive, 0o600);
      const size = (await fs.stat(archive)).size;
      const record: DataExportRecord = { id, filename, createdAt: Date.now(), size, appVersion: this.appVersion };
      await fs.writeFile(manifestPath, `${JSON.stringify({ version: 1, record }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await this.prune();
      this.log('data_export_created', { id, size });
      return record;
    } catch (error) {
      await fs.unlink(archive).catch(() => undefined);
      throw error;
    } finally {
      await fs.rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async list(): Promise<DataExportRecord[]> {
    await this.initialize();
    const names = await fs.readdir(this.exportDir).catch(() => [] as string[]);
    const records: DataExportRecord[] = [];
    for (const name of names) {
      if (!name.endsWith('.manifest.json')) continue;
      try {
        const raw = JSON.parse(await fs.readFile(path.join(this.exportDir, name), 'utf8')) as { version?: number; record?: DataExportRecord };
        if (raw.version === 1 && raw.record && ID_PATTERN.test(raw.record.id)) records.push(raw.record);
      } catch { /* ignora manifest corrotto */ }
    }
    return records.sort((a, b) => b.createdAt - a.createdAt);
  }

  async delete(id: string): Promise<{ id: string }> {
    this.validateId(id);
    await fs.unlink(this.getFile(id)).catch(() => undefined);
    await fs.unlink(path.join(this.exportDir, `${id}.manifest.json`)).catch(() => undefined);
    return { id };
  }

  getFile(id: string): string {
    this.validateId(id);
    return path.join(this.exportDir, `${id}.tar.gz`);
  }

  private async prune(): Promise<void> {
    const exports = await this.list();
    for (const record of exports.slice(5)) await this.delete(record.id).catch(() => undefined);
  }

  private validateId(id: string): void {
    if (!ID_PATTERN.test(id)) throw new DataExportError('export_not_found', 'Esportazione non trovata', 404);
  }
}
