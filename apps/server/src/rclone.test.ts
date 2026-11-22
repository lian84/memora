import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackupRecord } from '@memora/shared';
import { RcloneError, RcloneService } from './rclone.js';

const dirs: string[] = [];
async function fixture(): Promise<{ dataDir: string; backupDir: string; record: BackupRecord }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-rclone-'));
  dirs.push(root);
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });
  const record: BackupRecord = {
    id: 'memora-backup-test', archiveName: 'memora-backup-test.mbackup', createdAt: Date.now(),
    size: 10, sha256: 'abc', encrypted: true, appVersion: 'test', trigger: 'manual',
  };
  await fs.writeFile(path.join(backupDir, record.archiveName), 'archive');
  await fs.writeFile(path.join(backupDir, `${record.id}.manifest.json`), 'manifest');
  return { dataDir, backupDir, record };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

function fakeRunner(calls: string[][], syncFiles?: string[][]): (args: string[], input?: string) => Promise<{ stdout: string; stderr: string }> {
  return async (args, input) => {
    void input;
    calls.push(args);
    if (args[0] === 'version') return { stdout: 'rclone v1', stderr: '' };
    if (args[0] === 'obscure') return { stdout: 'obscured-password\n', stderr: '' };
    if (args[0] === 'sync' && syncFiles) syncFiles.push(await fs.readdir(args[1]!));
    return { stdout: '', stderr: '' };
  };
}

describe('RcloneService', () => {
  it('configura Mega, salva solo la password offuscata e verifica la connessione', async () => {
    const { dataDir, backupDir, record } = await fixture();
    const calls: string[][] = [];
    const service = new RcloneService({ dataDir, backupDir, getBackups: () => [record], runner: fakeRunner(calls) });
    await service.load();
    const status = await service.configure({ remoteName: 'memora-mega', email: 'me@example.com', password: 'mega-password', twoFactor: '123456', folder: 'memora-backups', autoUpload: true });
    expect(status).toMatchObject({ rcloneAvailable: true, configured: true, remoteName: 'memora-mega', folder: 'memora-backups', autoUpload: true });
    const config = await fs.readFile(path.join(dataDir, 'config', 'rclone.conf'), 'utf8');
    expect(config).toContain('pass = obscured-password');
    expect(config).not.toContain('mega-password');
    expect(config).toContain('2fa = 123456');
    expect((await fs.stat(path.join(dataDir, 'config', 'rclone.conf'))).mode & 0o777).toBe(0o600);
    const metadata = await fs.readFile(path.join(dataDir, 'config', 'backup-remote.json'), 'utf8');
    expect(metadata).not.toContain('mega-password');
  });

  it('carica solo l’ultimo archivio in una cartella di staging', async () => {
    const { dataDir, backupDir, record } = await fixture();
    const calls: string[][] = [];
    const syncFiles: string[][] = [];
    const service = new RcloneService({ dataDir, backupDir, getBackups: () => [record], runner: fakeRunner(calls, syncFiles) });
    await service.load();
    await service.configure({ remoteName: 'mega', email: 'me@example.com', password: 'password', folder: 'backups', autoUpload: true });
    const status = await service.uploadLatest();
    expect(status.lastUploadName).toBe(record.archiveName);
    expect(syncFiles[0]?.sort()).toEqual([`${record.id}.manifest.json`, record.archiveName].sort());
    expect(calls.some(args => args[0] === 'sync' && args[2] === 'mega:backups')).toBe(true);
  });

  it('rifiuta la configurazione se rclone non è disponibile', async () => {
    const { dataDir, backupDir, record } = await fixture();
    const runner = async () => { throw new RcloneError('missing', 'not found', 500); };
    const service = new RcloneService({ dataDir, backupDir, getBackups: () => [record], runner });
    await service.load();
    await expect(service.configure({ remoteName: 'mega', email: 'me@example.com', password: 'password', folder: 'backups' })).rejects.toMatchObject({ code: 'rclone_not_installed' });
  });

  it('valida nome, email e cartella', async () => {
    const { dataDir, backupDir, record } = await fixture();
    const service = new RcloneService({ dataDir, backupDir, getBackups: () => [record], runner: fakeRunner([]) });
    await service.load();
    await expect(service.configure({ remoteName: 'bad name', email: 'me@example.com', password: 'password', folder: 'backups' })).rejects.toMatchObject({ code: 'invalid_rclone_config' });
    await expect(service.configure({ remoteName: 'mega', email: 'not-email', password: 'password', folder: 'backups' })).rejects.toMatchObject({ code: 'invalid_rclone_config' });
    await expect(service.configure({ remoteName: 'mega', email: 'me@example.com', password: 'password', folder: '../backups' })).rejects.toMatchObject({ code: 'invalid_rclone_config' });
  });
});
