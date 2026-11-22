import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupService, decryptBackupFile } from './backup.js';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];
async function fixture(): Promise<{ dataDir: string; backupDir: string; service: BackupService }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-backup-test-'));
  dirs.push(root);
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  await fs.mkdir(path.join(dataDir, 'memory'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'models'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'memory', 'note.md'), '# Nota\n');
  await fs.writeFile(path.join(dataDir, 'models', 'large.bin'), 'excluded');
  const service = new BackupService({ dataDir, appVersion: 'test', env: { MEMORA_BACKUP_DIR: backupDir }, isIdle: () => true });
  await service.load();
  return { dataDir, backupDir, service };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('BackupService', () => {
  it('crea un archivio cifrato, manifest e permette il download', async () => {
    const { backupDir, service } = await fixture();
    await service.setPassword('backup-password-123');
    const record = await service.createBackup('manual');
    const archive = path.join(backupDir, record.archiveName);
    expect((await fs.stat(archive)).mode & 0o777).toBe(0o600);
    expect(record.encrypted).toBe(true);
    expect(record.size).toBeGreaterThan(0);
    expect(service.getStatus().lastBackup?.id).toBe(record.id);
    const decrypted = path.join(backupDir, 'decrypted.tar.gz');
    await decryptBackupFile(archive, decrypted, 'backup-password-123');
    const listing = (await execFileAsync('tar', ['-tzf', decrypted])).stdout;
    expect(listing).toContain('memory/note.md');
    expect(listing).not.toContain('models/large.bin');
    await expect(decryptBackupFile(archive, path.join(backupDir, 'wrong.tar.gz'), 'wrong-password-123')).rejects.toMatchObject({ code: 'backup_wrong_password' });
  });

  it('non avvia il backup se la password manca', async () => {
    const { service } = await fixture();
    await expect(service.createBackup('manual')).rejects.toMatchObject({ code: 'backup_password_missing' });
  });

  it('attende l’idle e libera la manutenzione in caso di errore', async () => {
    const { dataDir, backupDir } = await fixture();
    const idle = vi.fn(() => false);
    const waiting = new BackupService({ dataDir, appVersion: 'test', env: { MEMORA_BACKUP_DIR: backupDir }, isIdle: idle, idleTimeoutMs: 100 });
    await waiting.load();
    await waiting.setPassword('backup-password-123');
    await expect(waiting.createBackup('manual')).rejects.toMatchObject({ code: 'backup_activity_timeout' });
    expect(waiting.isMaintenance()).toBe(false);
  });

  it('mantiene la retention richiesta', async () => {
    const { service } = await fixture();
    await service.setPassword('backup-password-123');
    await service.updateSchedule({ enabled: false, frequency: 'weekly', weekday: 0, time: '03:00', timezone: 'Europe/Rome', retention: 2 });
    await service.createBackup('manual');
    await service.createBackup('manual');
    await service.createBackup('manual');
    expect(service.listBackups()).toHaveLength(2);
  });

  it('valida e calcola la prossima esecuzione', async () => {
    const { service } = await fixture();
    const schedule = await service.updateSchedule({ enabled: true, frequency: 'daily', time: '03:15', timezone: 'Europe/Rome', retention: 4 });
    expect(schedule.enabled).toBe(true);
    expect(service.getStatus().nextRunAt).toBeGreaterThan(Date.now());
    await expect(service.updateSchedule({ enabled: true, frequency: 'daily', time: '99:99', timezone: 'Europe/Rome', retention: 4 })).rejects.toBeInstanceOf(Error);
  });
});
