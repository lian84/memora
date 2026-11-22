import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutomationJob, BackupRemoteStatus, BackupStatus } from '@memora/shared';
import { MonitorService } from './monitor.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-monitor-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

function backup(overrides: Partial<BackupStatus> = {}): BackupStatus {
  return {
    passwordConfigured: true, maintenance: false, busy: false, localDir: '/tmp',
    schedule: { enabled: true, frequency: 'weekly', weekday: 0, time: '03:00', timezone: 'Europe/Rome', retention: 4 },
    backups: [], ...overrides,
  };
}
function remote(overrides: Partial<BackupRemoteStatus> = {}): BackupRemoteStatus {
  return { rcloneAvailable: true, configured: true, autoUpload: true, busy: false, ...overrides };
}
function job(overrides: Partial<AutomationJob> = {}): AutomationJob {
  const now = Date.now();
  return { id: 'job_test', name: 'Test', prompt: 'Test', cron: '0 9 * * *', timezone: 'Europe/Rome', enabled: true, mcp: { enabled: [] }, notifyTelegram: false, webEnabled: false, timeoutMinutes: 10, maxAttempts: 1, createdAt: now, updatedAt: now, ...overrides };
}

describe('MonitorService', () => {
  it('crea avvisi per backup vecchio, remoto e automazione fallita', async () => {
    const notify = vi.fn(async () => true);
    const service = new MonitorService({
      dataDir: await tempDir(),
      getBackupStatus: () => backup({ lastBackup: { id: 'b', archiveName: 'b.mbackup', createdAt: Date.now() - 9 * 86_400_000, size: 1, sha256: 'x', encrypted: true, appVersion: 'test', trigger: 'manual' } }),
      getRemoteStatus: async () => remote({ lastError: 'upload failed' }),
      getJobs: () => [job({ lastRunStatus: 'failed', lastRunAt: Date.now() - 60_000 })],
      getDiskPercent: async () => 10,
      notify,
    });
    await service.load();
    const status = await service.getStatus(true);
    expect(status.alerts.map(alert => alert.key)).toEqual(expect.arrayContaining(['backup_old', 'remote_upload_failed', 'automation_job_test']));
    expect(notify).toHaveBeenCalledTimes(1);
    await service.getStatus(true);
    expect(notify).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it('non notifica due volte lo stesso avviso e lo rimuove dopo il rientro', async () => {
    const notify = vi.fn(async () => true);
    const remoteStatus = remote({ lastError: 'temporary' });
    const service = new MonitorService({
      dataDir: await tempDir(),
      getBackupStatus: () => backup({ lastBackup: { id: 'b', archiveName: 'b.mbackup', createdAt: Date.now(), size: 1, sha256: 'x', encrypted: true, appVersion: 'test', trigger: 'manual' } }),
      getRemoteStatus: async () => remoteStatus,
      getJobs: () => [],
      getDiskPercent: async () => 10,
      notify,
    });
    await service.load();
    expect((await service.getStatus(true)).alerts).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
    remoteStatus.lastError = undefined;
    expect((await service.getStatus(true)).alerts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it('salva le soglie e disattiva il monitoraggio', async () => {
    const service = new MonitorService({ dataDir: await tempDir(), getBackupStatus: () => backup(), getRemoteStatus: async () => remote({ configured: false }), getJobs: () => [], getDiskPercent: async () => 10 });
    await service.load();
    const status = await service.updateSettings({ enabled: false, diskWarningPercent: 70, diskCriticalPercent: 85, backupMaxAgeDays: 14 });
    expect(status.settings).toMatchObject({ enabled: false, diskWarningPercent: 70, diskCriticalPercent: 85, backupMaxAgeDays: 14 });
    service.stop();
  });
});
