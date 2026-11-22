import fs from 'node:fs/promises';
import path from 'node:path';
import { statfs } from 'node:fs/promises';
import type {
  AutomationJob,
  BackupRemoteStatus,
  BackupStatus,
  MonitorAlert,
  MonitorSettings,
  MonitorStatus,
} from '@memora/shared';

interface MonitorConfigFile {
  version: 1;
  settings: MonitorSettings;
}

interface AlertState {
  active: boolean;
  since: number;
  severity: MonitorAlert['severity'];
  title: string;
  detail: string;
  lastNotifiedAt?: number;
}

interface MonitorStateFile {
  version: 1;
  checkedAt?: number;
  diskPercent?: number | null;
  alerts: Record<string, AlertState>;
}

type MonitorNotifier = (alerts: MonitorAlert[]) => Promise<boolean>;

export interface MonitorServiceOptions {
  dataDir: string;
  getBackupStatus: () => BackupStatus;
  getRemoteStatus: () => Promise<BackupRemoteStatus>;
  getJobs: () => AutomationJob[];
  notify?: MonitorNotifier;
  getDiskPercent?: (target: string) => Promise<number | null>;
  log?: (event: string, details?: Record<string, unknown>) => void;
  now?: () => number;
}

const DEFAULT_SETTINGS: MonitorSettings = {
  enabled: true,
  notifyTelegram: true,
  diskWarningPercent: 80,
  diskCriticalPercent: 90,
  backupMaxAgeDays: 8,
};

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function normalizeSettings(value: unknown): MonitorSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_SETTINGS };
  const data = value as Partial<MonitorSettings>;
  const warning = clamp(data.diskWarningPercent, DEFAULT_SETTINGS.diskWarningPercent, 50, 99);
  const critical = clamp(data.diskCriticalPercent, DEFAULT_SETTINGS.diskCriticalPercent, warning + 1, 100);
  return {
    enabled: data.enabled !== false,
    notifyTelegram: data.notifyTelegram !== false,
    diskWarningPercent: warning,
    diskCriticalPercent: critical,
    backupMaxAgeDays: Math.round(clamp(data.backupMaxAgeDays, DEFAULT_SETTINGS.backupMaxAgeDays, 1, 365)),
  };
}


/** Monitor leggero per backup, remoto, automazioni e spazio disco. */
export class MonitorService {
  readonly configPath: string;
  readonly statePath: string;
  private readonly dataDir: string;
  private readonly getBackupStatus: () => BackupStatus;
  private readonly getRemoteStatus: () => Promise<BackupRemoteStatus>;
  private readonly getJobs: () => AutomationJob[];
  private readonly notify?: MonitorNotifier;
  private readonly getDiskPercent: (target: string) => Promise<number | null>;
  private readonly log: (event: string, details?: Record<string, unknown>) => void;
  private readonly now: () => number;
  private settings: MonitorSettings = { ...DEFAULT_SETTINGS };
  private state: MonitorStateFile = { version: 1, alerts: {} };
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(options: MonitorServiceOptions) {
    this.dataDir = options.dataDir;
    this.getBackupStatus = options.getBackupStatus;
    this.getRemoteStatus = options.getRemoteStatus;
    this.getJobs = options.getJobs;
    this.notify = options.notify;
    this.getDiskPercent = options.getDiskPercent ?? (target => this.measureDisk(target));
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.configPath = path.join(options.dataDir, 'config', 'monitor.json');
    this.statePath = path.join(options.dataDir, 'config', 'monitor-state.json');
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.configPath, 'utf8')) as Partial<MonitorConfigFile>;
      if (raw.version === 1) this.settings = normalizeSettings(raw.settings);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.log('monitor_config_ignored');
    }
    try {
      const raw = JSON.parse(await fs.readFile(this.statePath, 'utf8')) as Partial<MonitorStateFile>;
      if (raw.version === 1 && raw.alerts && typeof raw.alerts === 'object') this.state = { version: 1, checkedAt: raw.checkedAt, diskPercent: raw.diskPercent ?? null, alerts: raw.alerts };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.log('monitor_state_ignored');
    }
  }

  async getStatus(force = false): Promise<MonitorStatus> {
    if (this.settings.enabled && (force || !this.state.checkedAt || this.now() - this.state.checkedAt > 15 * 60 * 1000)) {
      await this.check();
    }
    return this.toStatus();
  }

  async updateSettings(input: Partial<MonitorSettings>): Promise<MonitorStatus> {
    this.settings = normalizeSettings({ ...this.settings, ...input });
    const payload: MonitorConfigFile = { version: 1, settings: this.settings };
    await this.atomicWrite(this.configPath, `${JSON.stringify(payload, null, 2)}\n`);
    if (this.settings.enabled) this.start(); else this.stop();
    return this.toStatus();
  }

  start(): void {
    if (this.timer || !this.settings.enabled) return;
    this.timer = setInterval(() => { void this.check(); }, 15 * 60 * 1000);
    this.timer.unref?.();
    this.initialTimer = setTimeout(() => { void this.check(); }, 45_000);
    this.initialTimer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  private async check(): Promise<void> {
    if (this.busy || !this.settings.enabled) return;
    this.busy = true;
    let diskPercent: number | null = null;
    try {
      const backup = this.getBackupStatus();
      const remote = await this.getRemoteStatus().catch(() => null);
      const jobs = this.getJobs();
      diskPercent = await this.getDiskPercent(this.dataDir);
      const alerts: MonitorAlert[] = [];
      const now = this.now();

      if (diskPercent !== null && diskPercent >= this.settings.diskCriticalPercent) {
        alerts.push({ key: 'disk_critical', severity: 'critical', title: 'Spazio disco quasi esaurito', detail: `Utilizzo dati al ${diskPercent.toFixed(1)}%.`, active: true, since: now });
      } else if (diskPercent !== null && diskPercent >= this.settings.diskWarningPercent) {
        alerts.push({ key: 'disk_warning', severity: 'warning', title: 'Spazio disco in esaurimento', detail: `Utilizzo dati al ${diskPercent.toFixed(1)}%.`, active: true, since: now });
      }

      const lastBackupAt = backup.lastBackup?.createdAt;
      const maxAge = this.settings.backupMaxAgeDays * 86_400_000;
      if (backup.schedule.enabled && !lastBackupAt) {
        alerts.push({ key: 'backup_missing', severity: 'warning', title: 'Nessun backup disponibile', detail: 'Il backup automatico è attivo ma non esiste ancora un archivio.', active: true, since: now });
      } else if (lastBackupAt && now - lastBackupAt > maxAge) {
        alerts.push({ key: 'backup_old', severity: 'warning', title: 'Backup locale vecchio', detail: `L’ultimo backup ha più di ${this.settings.backupMaxAgeDays} giorni.`, active: true, since: now });
      }
      if (backup.lastError && (!lastBackupAt || (backup.lastFailureAt ?? 0) > lastBackupAt)) {
        alerts.push({ key: 'backup_failed', severity: 'critical', title: 'Backup fallito', detail: backup.lastError.slice(0, 400), active: true, since: now });
      }
      if (remote?.configured && remote.lastError) {
        alerts.push({ key: 'remote_upload_failed', severity: 'warning', title: 'Upload remoto fallito', detail: remote.lastError.slice(0, 400), active: true, since: now });
      }
      for (const job of jobs) {
        if (job.lastRunStatus === 'failed' || job.lastRunStatus === 'timeout') {
          const age = job.lastRunAt ? now - job.lastRunAt : 0;
          if (age <= 7 * 86_400_000) {
            alerts.push({
              key: `automation_${job.id}`,
              severity: 'warning',
              title: `Automazione fallita: ${job.name}`,
              detail: job.lastRunStatus === 'timeout' ? 'L’ultima esecuzione è andata in timeout.' : 'L’ultima esecuzione è fallita.',
              active: true,
              since: now,
            });
          }
        }
      }

      await this.applyTransition(alerts);
      this.state.checkedAt = now;
      this.state.diskPercent = diskPercent;
      await this.persistState();
      this.log('monitor_checked', { alerts: alerts.length, diskPercent });
    } catch (error) {
      this.log('monitor_check_failed', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.busy = false;
      if (diskPercent === null) this.state.checkedAt = this.now();
    }
  }

  private async applyTransition(alerts: MonitorAlert[]): Promise<void> {
    const previous = this.state.alerts;
    const next: Record<string, AlertState> = {};
    const newAlerts: MonitorAlert[] = [];
    for (const alert of alerts) {
      const old = previous[alert.key];
      const state: AlertState = {
        active: true,
        since: old?.since ?? alert.since,
        severity: alert.severity,
        title: alert.title,
        detail: alert.detail,
        ...(old?.lastNotifiedAt ? { lastNotifiedAt: old.lastNotifiedAt } : {}),
      };
      next[alert.key] = state;
      if (!old?.lastNotifiedAt) newAlerts.push({ ...alert, since: state.since });
    }
    const recovered = Object.entries(previous).filter(([key, state]) => state.active && !next[key]);
    this.state.alerts = next;
    if (this.settings.notifyTelegram && this.notify && newAlerts.length > 0) {
      const sent = await this.notify(newAlerts).catch(() => false);
      if (sent) {
        for (const alert of newAlerts) {
          if (next[alert.key]) next[alert.key]!.lastNotifiedAt = this.now();
        }
      }
    }
    if (this.settings.notifyTelegram && this.notify && recovered.length > 0) {
      const recoveredAlerts: MonitorAlert[] = recovered.map(([key, state]) => ({
        key, severity: 'warning' as const, title: 'Avviso rientrato', detail: key, active: false, since: state.since,
      }));
      await this.notify(recoveredAlerts).catch(() => false);
    }
  }

  private toStatus(): MonitorStatus {
    const alerts = Object.entries(this.state.alerts)
      .filter(([, state]) => state.active)
      .map(([key, state]) => ({ key, severity: state.severity, title: state.title, detail: state.detail, active: true, since: state.since, ...(state.lastNotifiedAt ? { lastNotifiedAt: state.lastNotifiedAt } : {}) }));
    return {
      settings: { ...this.settings },
      ...(this.state.checkedAt ? { checkedAt: this.state.checkedAt } : {}),
      alerts,
      disk: { available: this.state.diskPercent !== null && this.state.diskPercent !== undefined, percent: this.state.diskPercent ?? null },
    };
  }

  private async measureDisk(target: string): Promise<number | null> {
    try {
      const stats = await statfs(target);
      const total = Number(stats.blocks) * Number(stats.bsize);
      const available = Number(stats.bavail) * Number(stats.bsize);
      if (!total || total <= 0) return null;
      return Math.min(100, Math.max(0, ((total - available) / total) * 100));
    } catch {
      return null;
    }
  }

  private async persistState(): Promise<void> {
    this.state.checkedAt = this.state.checkedAt ?? this.now();
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
