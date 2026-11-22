import fs from 'node:fs/promises';
import path from 'node:path';
import type { UpdateSettings, UpdateStatus } from '@memora/shared';

const DEFAULT_REPOSITORY = 'lian84/memora';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CACHE_MS = 6 * 60 * 60 * 1000;

interface UpdateConfigFile {
  version: 1;
  settings: UpdateSettings;
}

interface UpdateStateFile {
  version: 1;
  checkedAt?: number;
  latestVersion?: string;
  releaseName?: string;
  releaseUrl?: string;
  notes?: string;
  error?: string;
  notifiedTag?: string;
}

type FetchLike = typeof fetch;
type UpdateNotifier = (status: UpdateStatus) => Promise<boolean>;

export interface UpdateServiceOptions {
  dataDir: string;
  currentVersion: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  notify?: UpdateNotifier;
  log?: (event: string, details?: Record<string, unknown>) => void;
  now?: () => number;
}

function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] => {
    const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i]! > right[i]!) return 1;
    if (left[i]! < right[i]!) return -1;
  }
  return 0;
}

/** Controlla le release pubblicate, mai i singoli push su main. */
export class UpdateService {
  readonly configPath: string;
  readonly statePath: string;
  readonly repository: string;
  private readonly currentVersion: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: FetchLike;
  private readonly notify?: UpdateNotifier;
  private readonly log: (event: string, details?: Record<string, unknown>) => void;
  private readonly now: () => number;
  private settings: UpdateSettings = { enabled: true, notifyTelegram: true };
  private state: UpdateStateFile = { version: 1 };
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(options: UpdateServiceOptions) {
    this.currentVersion = options.currentVersion;
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.notify = options.notify;
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.repository = this.env.MEMORA_UPDATE_REPO?.trim() || DEFAULT_REPOSITORY;
    this.configPath = path.join(options.dataDir, 'config', 'update.json');
    this.statePath = path.join(options.dataDir, 'config', 'update-state.json');
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.configPath, 'utf8')) as Partial<UpdateConfigFile>;
      if (raw.version === 1 && raw.settings) {
        this.settings = {
          enabled: raw.settings.enabled !== false,
          notifyTelegram: raw.settings.notifyTelegram !== false,
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.log('update_config_ignored');
    }
    try {
      const raw = JSON.parse(await fs.readFile(this.statePath, 'utf8')) as Partial<UpdateStateFile>;
      if (raw.version === 1) this.state = { version: 1, ...raw };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.log('update_state_ignored');
    }
  }

  async getStatus(force = false): Promise<UpdateStatus> {
    if (this.settings.enabled && (force || !this.state.checkedAt || this.now() - this.state.checkedAt > CACHE_MS)) {
      await this.check(force);
    }
    return this.toStatus();
  }

  async updateSettings(input: UpdateSettings): Promise<UpdateStatus> {
    this.settings = { enabled: input.enabled === true, notifyTelegram: input.notifyTelegram === true };
    const payload: UpdateConfigFile = { version: 1, settings: this.settings };
    await this.atomicWrite(this.configPath, `${JSON.stringify(payload, null, 2)}\n`);
    if (this.settings.enabled) this.start(); else this.stop();
    return this.toStatus();
  }

  start(): void {
    if (this.timer || !this.settings.enabled) return;
    this.timer = setInterval(() => { void this.check(false); }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
    this.initialTimer = setTimeout(() => { void this.check(false); }, 30_000);
    this.initialTimer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  private async check(force: boolean): Promise<void> {
    if (this.busy || !this.settings.enabled) return;
    if (!force && this.state.checkedAt && this.now() - this.state.checkedAt < CACHE_MS) return;
    this.busy = true;
    try {
      const headers: Record<string, string> = {
        accept: 'application/vnd.github+json',
        'user-agent': 'memora-update-check',
      };
      const token = this.env.MEMORA_UPDATE_CHECK_TOKEN?.trim();
      if (token) headers.authorization = `Bearer ${token}`;
      const url = this.env.MEMORA_UPDATE_CHECK_URL?.trim()
        || `https://api.github.com/repos/${this.repository}/releases/latest`;
      let response: Response;
      try {
        response = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
      } catch {
        this.state = { ...this.state, checkedAt: this.now(), error: 'network' };
        await this.persistState();
        return;
      }
      if (response.status === 404 || response.status === 401 || response.status === 403) {
        this.state = { ...this.state, checkedAt: this.now(), error: 'repository_private_or_unavailable', latestVersion: undefined, releaseName: undefined, releaseUrl: undefined, notes: undefined };
        await this.persistState();
        return;
      }
      if (!response.ok) {
        this.state = { ...this.state, checkedAt: this.now(), error: `github_${response.status}` };
        await this.persistState();
        return;
      }
      const data = await response.json() as {
        tag_name?: unknown;
        name?: unknown;
        html_url?: unknown;
        body?: unknown;
      };
      if (typeof data.tag_name !== 'string' || !data.tag_name.trim()) {
        this.state = { ...this.state, checkedAt: this.now(), error: 'invalid_release' };
        await this.persistState();
        return;
      }
      const latestVersion = data.tag_name.trim();
      this.state = {
        version: 1,
        checkedAt: this.now(),
        latestVersion,
        ...(typeof data.name === 'string' && data.name ? { releaseName: data.name.slice(0, 200) } : {}),
        ...(typeof data.html_url === 'string' ? { releaseUrl: data.html_url } : {}),
        ...(typeof data.body === 'string' ? { notes: data.body.slice(0, 4_000) } : {}),
        ...(this.state.notifiedTag ? { notifiedTag: this.state.notifiedTag } : {}),
      };
      await this.persistState();
      const updateAvailable = compareVersions(latestVersion, this.currentVersion) > 0;
      if (updateAvailable && this.settings.notifyTelegram && this.notify && this.state.notifiedTag !== latestVersion) {
        const sent = await this.notify(this.toStatus()).catch(() => false);
        if (sent) {
          this.state = { ...this.state, notifiedTag: latestVersion };
          await this.persistState();
        }
      }
      this.log('update_checked', { currentVersion: this.currentVersion, latestVersion, updateAvailable });
    } finally {
      this.busy = false;
    }
  }

  private toStatus(): UpdateStatus {
    const latest = this.state.latestVersion;
    return {
      currentVersion: this.currentVersion,
      repository: this.repository,
      enabled: this.settings.enabled,
      notifyTelegram: this.settings.notifyTelegram,
      updateAvailable: Boolean(latest && compareVersions(latest, this.currentVersion) > 0),
      ...(this.state.checkedAt ? { checkedAt: this.state.checkedAt } : {}),
      ...(latest ? { latestVersion: latest } : {}),
      ...(this.state.releaseName ? { releaseName: this.state.releaseName } : {}),
      ...(this.state.releaseUrl ? { releaseUrl: this.state.releaseUrl } : {}),
      ...(this.state.notes ? { notes: this.state.notes } : {}),
      ...(this.state.error ? { error: this.state.error } : {}),
    };
  }

  private async persistState(): Promise<void> {
    await this.atomicWrite(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  private async atomicWrite(file: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  }
}
