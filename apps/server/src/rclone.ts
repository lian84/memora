import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { BackupRecord, BackupRemoteInput, BackupRemoteStatus } from '@memora/shared';

interface RemoteMetadata {
  version: 1;
  remoteName: string;
  folder: string;
  autoUpload: boolean;
  lastUploadAt?: number;
  lastUploadName?: string;
  lastError?: string;
}

type RcloneRunner = (args: string[], input?: string) => Promise<{ stdout: string; stderr: string }>;

export class RcloneError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'RcloneError';
  }
}

export interface RcloneServiceOptions {
  dataDir: string;
  backupDir: string;
  getBackups: () => BackupRecord[];
  runner?: RcloneRunner;
  env?: NodeJS.ProcessEnv;
  log?: (event: string, details?: Record<string, unknown>) => void;
}

const REMOTE_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function safeText(value: unknown, field: string, max = 300): string {
  if (typeof value !== 'string') throw new RcloneError('invalid_rclone_config', `${field} non valido`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\r\n\0]/.test(trimmed)) throw new RcloneError('invalid_rclone_config', `${field} non valido`);
  return trimmed;
}

function safeFolder(value: unknown): string {
  const folder = safeText(value, 'Cartella remota', 300).replace(/^\/+|\/+$/g, '');
  if (!folder || folder.split('/').some(part => part === '..' || part === '.')) throw new RcloneError('invalid_rclone_config', 'Cartella remota non valida');
  return folder;
}

async function defaultRunner(binary: string, args: string[], input?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => reject(error));
    child.once('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new RcloneError('rclone_command_failed', stderr.trim().slice(0, 800) || `rclone exit ${code}`, 502));
    });
    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

/** Wizard Mega e upload dell'ultimo archivio, con solo la copia più recente sul remoto. */
export class RcloneService {
  readonly configPath: string;
  readonly metadataPath: string;
  private readonly dataDir: string;
  private readonly backupDir: string;
  private readonly getBackups: () => BackupRecord[];
  private readonly runner: RcloneRunner | null;
  private readonly env: NodeJS.ProcessEnv;
  private readonly log: (event: string, details?: Record<string, unknown>) => void;
  private metadata: RemoteMetadata | null = null;
  private busy = false;
  private available: boolean | null = null;
  private availableCheckedAt = 0;
  private binaryPath: string | null = null;

  constructor(options: RcloneServiceOptions) {
    this.dataDir = options.dataDir;
    this.backupDir = options.backupDir;
    this.getBackups = options.getBackups;
    this.runner = options.runner ?? null;
    this.env = options.env ?? process.env;
    this.log = options.log ?? (() => undefined);
    this.configPath = path.join(options.dataDir, 'config', 'rclone.conf');
    this.metadataPath = path.join(options.dataDir, 'config', 'backup-remote.json');
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.metadataPath, 'utf8')) as Partial<RemoteMetadata>;
      if (raw.version === 1 && typeof raw.remoteName === 'string' && typeof raw.folder === 'string') {
        this.metadata = {
          version: 1,
          remoteName: raw.remoteName,
          folder: raw.folder,
          autoUpload: raw.autoUpload === true,
          ...(typeof raw.lastUploadAt === 'number' ? { lastUploadAt: raw.lastUploadAt } : {}),
          ...(typeof raw.lastUploadName === 'string' ? { lastUploadName: raw.lastUploadName } : {}),
          ...(typeof raw.lastError === 'string' ? { lastError: raw.lastError } : {}),
        };
      }
      await fs.chmod(this.metadataPath, 0o600).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.log('backup_remote_config_ignored');
    }
    await this.checkAvailable();
  }

  async status(): Promise<BackupRemoteStatus> {
    const available = await this.checkAvailable();
    return {
      rcloneAvailable: available,
      configured: Boolean(this.metadata),
      ...(this.metadata ? { remoteName: this.metadata.remoteName, folder: this.metadata.folder, autoUpload: this.metadata.autoUpload } : { autoUpload: false }),
      busy: this.busy,
      ...(this.metadata?.lastUploadAt ? { lastUploadAt: this.metadata.lastUploadAt } : {}),
      ...(this.metadata?.lastUploadName ? { lastUploadName: this.metadata.lastUploadName } : {}),
      ...(this.metadata?.lastError ? { lastError: this.metadata.lastError } : {}),
    };
  }

  async configure(input: BackupRemoteInput): Promise<BackupRemoteStatus> {
    if (!(await this.checkAvailable())) throw new RcloneError('rclone_not_installed', 'rclone non è installato sul server', 409);
    const remoteName = safeText(input.remoteName, 'Nome remote', 64);
    if (!REMOTE_NAME.test(remoteName)) throw new RcloneError('invalid_rclone_config', 'Il nome del remote può contenere solo lettere, numeri, _ e -');
    const email = safeText(input.email, 'Email Mega', 320);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RcloneError('invalid_rclone_config', 'Email Mega non valida');
    const password = safeText(input.password, 'Password Mega', 512);
    const folder = safeFolder(input.folder);
    const twoFactor = input.twoFactor?.trim() || '';
    if (twoFactor && !/^\d{6,10}$/.test(twoFactor)) throw new RcloneError('invalid_rclone_config', 'Codice 2FA non valido');
    if (this.busy) throw new RcloneError('rclone_busy', 'Configurazione o upload già in corso', 409);

    this.busy = true;
    const tempConfig = path.join(this.dataDir, 'config', `.rclone.${process.pid}.${Date.now()}.conf`);
    try {
      const obscured = (await this.run(['obscure', '-'], `${password}\n`)).stdout.trim();
      if (!obscured) throw new RcloneError('rclone_config_failed', 'Impossibile proteggere la password Mega', 502);
      const lines = [
        `[${remoteName}]`,
        'type = mega',
        `user = ${email}`,
        `pass = ${obscured}`,
        ...(twoFactor ? [`2fa = ${twoFactor}`] : []),
        '',
      ];
      await fs.mkdir(path.dirname(tempConfig), { recursive: true, mode: 0o700 });
      await fs.writeFile(tempConfig, lines.join('\n'), { mode: 0o600, flag: 'wx' });
      await this.run(['mkdir', `${remoteName}:${folder}`, '--config', tempConfig]);
      await fs.rename(tempConfig, this.configPath);
      await fs.chmod(this.configPath, 0o600);
      this.metadata = { version: 1, remoteName, folder, autoUpload: input.autoUpload === true };
      await this.persistMetadata();
      this.log('backup_remote_configured', { remoteName, folder });
      this.busy = false;
      return this.status();
    } catch (error) {
      await fs.unlink(tempConfig).catch(() => undefined);
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async updateAutoUpload(enabled: boolean): Promise<BackupRemoteStatus> {
    if (!this.metadata) throw new RcloneError('rclone_not_configured', 'Backup remoto non configurato', 409);
    this.metadata = { ...this.metadata, autoUpload: enabled === true, lastError: undefined };
    await this.persistMetadata();
    return this.status();
  }

  async uploadLatest(): Promise<BackupRemoteStatus> {
    if (!this.metadata) throw new RcloneError('rclone_not_configured', 'Backup remoto non configurato', 409);
    if (!(await this.checkAvailable())) throw new RcloneError('rclone_not_installed', 'rclone non è installato sul server', 409);
    const latest = this.getBackups()[0];
    if (!latest) throw new RcloneError('backup_not_found', 'Nessun backup locale da caricare', 404);
    if (this.busy) throw new RcloneError('rclone_busy', 'Un altro upload è in corso', 409);
    this.busy = true;
    const staging = await fs.mkdtemp(path.join(this.backupDir, '.upload-'));
    try {
      const latestArchive = path.join(this.backupDir, latest.archiveName);
      const latestManifest = path.join(this.backupDir, `${latest.id}.manifest.json`);
      await fs.copyFile(latestArchive, path.join(staging, latest.archiveName));
      await fs.copyFile(latestManifest, path.join(staging, `${latest.id}.manifest.json`));
      await this.run(['sync', staging, `${this.metadata.remoteName}:${this.metadata.folder}`, '--config', this.configPath, '--transfers', '1', '--checkers', '1']);
      this.metadata = {
        ...this.metadata,
        lastUploadAt: Date.now(),
        lastUploadName: latest.archiveName,
        lastError: undefined,
      };
      await this.persistMetadata();
      this.log('backup_remote_uploaded', { id: latest.id });
      this.busy = false;
      return this.status();
    } catch (error) {
      this.metadata = { ...this.metadata, lastError: error instanceof Error ? error.message.slice(0, 800) : String(error) };
      await this.persistMetadata();
      throw error;
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      this.busy = false;
    }
  }

  async disconnect(): Promise<BackupRemoteStatus> {
    this.metadata = null;
    await fs.unlink(this.metadataPath).catch(() => undefined);
    await fs.unlink(this.configPath).catch(() => undefined);
    return this.status();
  }

  async afterBackup(record: BackupRecord): Promise<void> {
    if (!this.metadata?.autoUpload) return;
    try {
      await this.uploadLatest();
    } catch (error) {
      this.log('backup_remote_auto_upload_failed', { id: record.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async run(args: string[], input?: string): Promise<{ stdout: string; stderr: string }> {
    if (this.runner) return this.runner(args, input);
    const binary = await this.resolveBinary();
    return defaultRunner(binary, args, input);
  }

  private async resolveBinary(): Promise<string> {
    if (this.binaryPath) return this.binaryPath;
    const configured = this.env.MEMORA_RCLONE_PATH?.trim();
    if (configured) {
      this.binaryPath = configured;
      return configured;
    }
    const local = path.join(this.dataDir, 'tools', 'rclone');
    try {
      await fs.access(local, (await import('node:fs')).constants.X_OK);
      this.binaryPath = local;
      return local;
    } catch {
      this.binaryPath = 'rclone';
      return 'rclone';
    }
  }

  private async checkAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.available !== null && now - this.availableCheckedAt < 30_000) return this.available;
    try {
      await this.run(['version']);
      this.available = true;
    } catch {
      this.available = false;
    }
    this.availableCheckedAt = now;
    return this.available;
  }

  private async persistMetadata(): Promise<void> {
    if (!this.metadata) return;
    await fs.mkdir(path.dirname(this.metadataPath), { recursive: true, mode: 0o700 });
    const temporary = `${this.metadataPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temporary, `${JSON.stringify(this.metadata, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, this.metadataPath);
    await fs.chmod(this.metadataPath, 0o600);
  }
}
