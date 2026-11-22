import fs from 'node:fs/promises';
import { createReadStream, createWriteStream, readdirSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { Cron } from 'croner';
import type { BackupFrequency, BackupRecord, BackupSchedule, BackupStatus, BackupTrigger } from '@memora/shared';

const PREFIX = Buffer.from('MEMORA-BACKUP\n1\n');
const EXCLUDED_DIRS = ['models', 'browser-libs', 'searxng', 'runtime', '.trash', 'backups', 'tools'];
const ID_PATTERN = /^memora-backup-[a-zA-Z0-9-]+$/;
const scryptAsync = promisify(scrypt);
const DEFAULT_SCHEDULE: BackupSchedule = {
  enabled: false,
  frequency: 'weekly',
  weekday: 0,
  time: '03:00',
  timezone: 'Europe/Rome',
  retention: 4,
};

interface BackupConfigFile {
  version: 1;
  schedule: BackupSchedule;
}

interface BackupSecretsFile {
  version: 1;
  password: string;
}

interface BackupManifest {
  version: 1;
  record: BackupRecord;
}

export class BackupError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface BackupServiceOptions {
  dataDir: string;
  appVersion: string;
  env?: NodeJS.ProcessEnv;
  log?: (event: string, details?: Record<string, unknown>) => void;
  /** Deve restituire true quando non ci sono turni, automazioni o scritture in corso. */
  isIdle: () => boolean | Promise<boolean>;
  idleTimeoutMs?: number;
}

function validPassword(value: unknown): string {
  if (typeof value !== 'string') throw new BackupError('invalid_backup_password', 'La password del backup non è valida');
  const password = value;
  if (password.length < 12 || password.length > 512 || [...password].some(char => char.charCodeAt(0) < 32)) {
    throw new BackupError('invalid_backup_password', 'La password del backup deve avere almeno 12 caratteri');
  }
  return password;
}

function validTime(value: unknown): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new BackupError('invalid_backup_schedule', 'Orario del backup non valido (usa HH:MM)');
  }
  return value;
}

function validTimezone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) throw new BackupError('invalid_backup_schedule', 'Fuso orario non valido');
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); } catch { throw new BackupError('invalid_backup_schedule', 'Fuso orario non valido'); }
  return value;
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function runTar(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => reject(new BackupError('backup_tar_failed', `tar non disponibile: ${error.message}`, 500)));
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new BackupError('backup_tar_failed', `Archivio non creato: ${stderr.trim().slice(0, 500) || `tar exit ${code}`}`, 500));
    });
  });
}

async function encryptFile(input: string, output: string, password: string): Promise<void> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scryptAsync(password, salt, 32) as Buffer;
  const header = Buffer.concat([PREFIX, Buffer.from(`${salt.toString('hex')}\n${iv.toString('hex')}\n`)]);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(output, { flags: 'wx', mode: 0o600 });
  try {
    out.write(header);
    for await (const chunk of createReadStream(input).pipe(cipher)) {
      if (!out.write(chunk)) await once(out, 'drain');
    }
    out.write(cipher.getAuthTag());
    out.end();
    await finished(out);
  } catch (error) {
    out.destroy();
    await fs.unlink(output).catch(() => undefined);
    throw error;
  }
}

/** Decripta un archivio in un file tar.gz. Usato dal restore e dai test. */
export async function decryptBackupFile(input: string, output: string, password: string): Promise<void> {
  const handle = await fs.open(input, 'r');
  try {
    const stat = await handle.stat();
    const prefixRead = Buffer.alloc(Math.min(stat.size, PREFIX.length + 200));
    await handle.read(prefixRead, 0, prefixRead.length, 0);
    if (!prefixRead.subarray(0, PREFIX.length).equals(PREFIX)) throw new BackupError('invalid_backup_archive', 'Formato backup non riconosciuto');
    const text = prefixRead.subarray(PREFIX.length).toString('utf8');
    const [saltHex, ivHex] = text.split('\n');
    if (!saltHex || !ivHex || !/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{24}$/i.test(ivHex)) {
      throw new BackupError('invalid_backup_archive', 'Header backup non valido');
    }
    const headerLength = PREFIX.length + saltHex.length + 1 + ivHex.length + 1;
    const authTagLength = 16;
    if (stat.size <= headerLength + authTagLength) throw new BackupError('invalid_backup_archive', 'Archivio backup troncato');
    const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 32) as Buffer;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    const tag = Buffer.alloc(authTagLength);
    await handle.read(tag, 0, authTagLength, stat.size - authTagLength);
    decipher.setAuthTag(tag);
    const source = createReadStream(input, { start: headerLength, end: stat.size - authTagLength - 1 });
    const out = createWriteStream(output, { flags: 'wx', mode: 0o600 });
    try {
      for await (const chunk of source.pipe(decipher)) {
        if (!out.write(chunk)) await once(out, 'drain');
      }
      out.end();
      await finished(out);
    } catch (error) {
      out.destroy();
      await fs.unlink(output).catch(() => undefined);
      if (error instanceof Error && /Unsupported state|auth/i.test(error.message)) {
        throw new BackupError('backup_wrong_password', 'Password del backup errata o archivio danneggiato');
      }
      throw error;
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Backup locali cifrati con password scelta dall'utente. */
export class BackupService {
  readonly dataDir: string;
  readonly backupDir: string;
  readonly configDir: string;
  readonly configPath: string;
  readonly secretsPath: string;
  private readonly appVersion: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly log: (event: string, details?: Record<string, unknown>) => void;
  private readonly isIdle: () => boolean | Promise<boolean>;
  private readonly idleTimeoutMs: number;
  private schedule: BackupSchedule = { ...DEFAULT_SCHEDULE };
  private password = '';
  private maintenance = false;
  private busy = false;
  private timer: NodeJS.Timeout | null = null;
  private nextRunAt: number | undefined;
  private writeChain: Promise<void> = Promise.resolve();
  private lastFailureAt?: number;
  private lastError?: string;
  private afterBackup?: (record: BackupRecord) => Promise<void>;

  constructor(options: BackupServiceOptions) {
    this.dataDir = options.dataDir;
    this.backupDir = path.resolve(options.env?.MEMORA_BACKUP_DIR ?? path.join(options.dataDir, '..', 'memora-backups'));
    this.configDir = path.join(options.dataDir, 'config');
    this.configPath = path.join(this.configDir, 'backup.json');
    this.secretsPath = path.join(this.configDir, 'backup-secrets.json');
    this.appVersion = options.appVersion;
    this.env = options.env ?? process.env;
    this.log = options.log ?? (() => undefined);
    this.isIdle = options.isIdle;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 120_000;
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.configPath, 'utf8')) as Partial<BackupConfigFile>;
      if (raw.version === 1 && raw.schedule) this.schedule = this.normalizeSchedule(raw.schedule);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.log('backup_config_ignored');
    }
    try {
      const raw = JSON.parse(await fs.readFile(this.secretsPath, 'utf8')) as Partial<BackupSecretsFile>;
      if (raw.version === 1 && typeof raw.password === 'string') this.password = raw.password;
      await fs.chmod(this.secretsPath, 0o600).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.log('backup_secrets_ignored');
    }
    await fs.mkdir(this.backupDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    this.refreshNextRun();
  }

  getPassword(): string | undefined {
    const environment = this.env.MEMORA_BACKUP_PASSWORD;
    if (environment) return environment;
    return this.password || undefined;
  }

  isMaintenance(): boolean {
    return this.maintenance;
  }

  getStatus(): BackupStatus {
    const backups = this.listBackupsSync();
    return {
      passwordConfigured: Boolean(this.getPassword()),
      maintenance: this.maintenance,
      busy: this.busy,
      localDir: this.backupDir,
      schedule: { ...this.schedule },
      ...(this.nextRunAt !== undefined ? { nextRunAt: this.nextRunAt } : {}),
      backups,
      ...(backups[0] ? { lastBackup: backups[0] } : {}),
      ...(this.lastFailureAt ? { lastFailureAt: this.lastFailureAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  async setPassword(value: unknown): Promise<void> {
    if (this.env.MEMORA_BACKUP_PASSWORD) throw new BackupError('backup_password_managed_by_environment', 'La password del backup è gestita dall’ambiente', 409);
    this.password = validPassword(value);
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    const payload: BackupSecretsFile = { version: 1, password: this.password };
    await this.atomicWrite(this.secretsPath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  async updateSchedule(input: unknown): Promise<BackupSchedule> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BackupError('invalid_backup_schedule', 'Pianificazione non valida');
    this.schedule = this.normalizeSchedule({ ...this.schedule, ...(input as Partial<BackupSchedule>) });
    const payload: BackupConfigFile = { version: 1, schedule: this.schedule };
    await this.atomicWrite(this.configPath, `${JSON.stringify(payload, null, 2)}\n`);
    this.refreshNextRun();
    return { ...this.schedule };
  }

  setAfterBackup(callback: (record: BackupRecord) => Promise<void>): void {
    this.afterBackup = callback;
  }

  async createBackup(trigger: BackupTrigger): Promise<BackupRecord> {
    const record = await this.createBackupInternal(trigger);
    if (this.afterBackup) await this.afterBackup(record).catch((error) => {
      this.log('backup_after_callback_failed', { error: error instanceof Error ? error.message : String(error) });
    });
    return record;
  }

  private async createBackupInternal(trigger: BackupTrigger): Promise<BackupRecord> {
    if (this.busy || this.maintenance) throw new BackupError('backup_busy', 'È già in corso un backup', 409);
    const password = this.getPassword();
    if (!password) throw new BackupError('backup_password_missing', 'Configura la password del backup prima di continuare', 409);
    this.busy = true;
    this.maintenance = true;
    const tempTar = path.join(this.backupDir, `.tmp-${process.pid}-${Date.now()}.tar.gz`);
    const id = `memora-backup-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`;
    const archiveName = `${id}.mbackup`;
    const archivePath = path.join(this.backupDir, archiveName);
    const manifestPath = path.join(this.backupDir, `${id}.manifest.json`);
    try {
      this.log('backup_waiting_idle', { trigger });
      await this.waitForIdle(this.idleTimeoutMs);
      await fs.mkdir(this.backupDir, { recursive: true, mode: 0o700 });
      const excludes = [...EXCLUDED_DIRS];
      const relativeBackup = path.relative(this.dataDir, this.backupDir);
      if (relativeBackup && !relativeBackup.startsWith('..') && !path.isAbsolute(relativeBackup)) excludes.push(relativeBackup);
      const args = ['-czf', tempTar, '-C', this.dataDir, ...excludes.map(dir => `--exclude=./${dir.replace(/^\/+/, '')}`), '.'];
      this.log('backup_archive_start', { trigger });
      await runTar(args);
      await encryptFile(tempTar, archivePath, password);
      await fs.chmod(archivePath, 0o600);
      const size = (await fs.stat(archivePath)).size;
      const sha256 = await hashFile(archivePath);
      const record: BackupRecord = {
        id,
        archiveName,
        createdAt: Date.now(),
        size,
        sha256,
        encrypted: true,
        appVersion: this.appVersion,
        trigger,
      };
      const manifest: BackupManifest = { version: 1, record };
      await this.atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await this.pruneRetention();
      this.lastError = undefined;
      this.lastFailureAt = undefined;
      this.log('backup_completed', { trigger, id, size });
      return record;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message.slice(0, 800) : String(error).slice(0, 800);
      this.lastFailureAt = Date.now();
      throw error;
    } finally {
      await fs.unlink(tempTar).catch(() => undefined);
      this.busy = false;
      this.maintenance = false;
      this.refreshNextRun();
    }
  }

  listBackups(): BackupRecord[] {
    return this.listBackupsSync();
  }

  getBackupFile(id: string): string {
    this.validateId(id);
    const file = path.join(this.backupDir, `${id}.mbackup`);
    return file;
  }

  async deleteBackup(id: string): Promise<{ id: string }> {
    this.validateId(id);
    await fs.unlink(this.getBackupFile(id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await fs.unlink(path.join(this.backupDir, `${id}.manifest.json`)).catch(() => undefined);
    return { id };
  }

  start(): void {
    if (this.timer) return;
    this.refreshNextRun();
    this.timer = setInterval(() => { void this.tick(); }, 30_000);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (!this.schedule.enabled || this.busy || this.maintenance) return;
    if (this.nextRunAt === undefined || this.nextRunAt > Date.now()) return;
    try {
      await this.createBackup('automatic');
    } catch (error) {
      this.log('backup_automatic_failed', { error: error instanceof Error ? error.message : String(error) });
      this.refreshNextRun();
    }
  }

  private async waitForIdle(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isIdle()) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new BackupError('backup_activity_timeout', 'Ci sono ancora attività in corso: riprova tra poco', 409);
  }

  private async pruneRetention(): Promise<void> {
    const backups = this.listBackupsSync();
    for (const backup of backups.slice(this.schedule.retention)) {
      await this.deleteBackup(backup.id).catch(() => undefined);
    }
  }

  private listBackupsSync(): BackupRecord[] {
    // La lista viene ricaricata da disco in modo sincrono per mantenere getStatus
    // semplice; i manifest sono piccoli e non contengono segreti.
    const names = (() => { try { return readdirSync(this.backupDir).filter(name => name.endsWith('.manifest.json')); } catch { return [] as string[]; } })();
    const records: BackupRecord[] = [];
    for (const name of names) {
      try {
        const raw = JSON.parse(readFileSync(path.join(this.backupDir, name), 'utf8')) as BackupManifest;
        if (raw.version === 1 && raw.record && ID_PATTERN.test(raw.record.id)) {
          records.push(raw.record);
        }
      } catch {
        // manifest non valido: ignora
      }
    }
    return records.sort((a, b) => b.createdAt - a.createdAt);
  }

  private normalizeSchedule(value: Partial<BackupSchedule>): BackupSchedule {
    const frequency: BackupFrequency = value.frequency === 'daily' ? 'daily' : 'weekly';
    const weekday = Number(value.weekday);
    const retention = Number(value.retention);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new BackupError('invalid_backup_schedule', 'Giorno della settimana non valido');
    if (!Number.isInteger(retention) || retention < 1 || retention > 20) throw new BackupError('invalid_backup_schedule', 'Retention non valida (1–20)');
    return {
      enabled: value.enabled === true,
      frequency,
      weekday,
      time: validTime(value.time),
      timezone: validTimezone(value.timezone),
      retention,
    };
  }

  private refreshNextRun(): void {
    if (!this.schedule.enabled) { this.nextRunAt = undefined; return; }
    try {
      const [hour, minute] = this.schedule.time.split(':').map(Number);
      const expression = this.schedule.frequency === 'weekly'
        ? `${minute} ${hour} * * ${this.schedule.weekday}`
        : `${minute} ${hour} * * *`;
      const next = new Cron(expression, { timezone: this.schedule.timezone, paused: true }).nextRun();
      this.nextRunAt = next?.getTime();
    } catch {
      this.nextRunAt = undefined;
    }
  }

  private validateId(id: string): void {
    if (!ID_PATTERN.test(id)) throw new BackupError('backup_not_found', 'Backup non trovato', 404);
  }

  private atomicWrite(file: string, content: string): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, file);
      await fs.chmod(file, 0o600);
    });
    return this.writeChain;
  }
}
