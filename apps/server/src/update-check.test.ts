import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateService } from './update-check.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-update-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('UpdateService', () => {
  it('rileva una release più recente e notifica una sola volta per tag', async () => {
    const notify = vi.fn(async () => true);
    const fetchMock = vi.fn(async () => response({ tag_name: 'v1.2.3', name: 'Memora 1.2.3', html_url: 'https://example.test/release', body: 'Novità' }));
    const service = new UpdateService({ dataDir: await tempDir(), currentVersion: '1.0.0', fetchImpl: fetchMock as unknown as typeof fetch, notify });
    await service.load();
    const first = await service.getStatus(true);
    expect(first).toMatchObject({ updateAvailable: true, latestVersion: 'v1.2.3', releaseName: 'Memora 1.2.3' });
    expect(notify).toHaveBeenCalledTimes(1);
    await service.getStatus(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('non considera aggiornabile la stessa versione', async () => {
    const fetchMock = vi.fn(async () => response({ tag_name: 'v1.0.0', html_url: 'https://example.test' }));
    const service = new UpdateService({ dataDir: await tempDir(), currentVersion: '1.0.0', fetchImpl: fetchMock as unknown as typeof fetch });
    await service.load();
    expect((await service.getStatus(true)).updateAvailable).toBe(false);
  });

  it('gestisce un repository privato senza esporre errori di credenziali', async () => {
    const fetchMock = vi.fn(async () => response({ message: 'Not Found' }, 404));
    const service = new UpdateService({ dataDir: await tempDir(), currentVersion: '1.0.0', fetchImpl: fetchMock as unknown as typeof fetch });
    await service.load();
    const status = await service.getStatus(true);
    expect(status.error).toBe('repository_private_or_unavailable');
    expect(status.updateAvailable).toBe(false);
    expect(JSON.stringify(status)).not.toContain('token');
  });

  it('salva le impostazioni e disattiva il controllo', async () => {
    const fetchMock = vi.fn();
    const service = new UpdateService({ dataDir: await tempDir(), currentVersion: '1.0.0', fetchImpl: fetchMock as unknown as typeof fetch });
    await service.load();
    await service.updateSettings({ enabled: false, notifyTelegram: false });
    const status = await service.getStatus(true);
    expect(status).toMatchObject({ enabled: false, notifyTelegram: false, updateAvailable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('UpdateService apply helper', () => {
  it('scrive una richiesta solo quando helper e release sono disponibili', async () => {
    const dir = await tempDir();
    const helper = path.join(dir, 'memora-update.path');
    const request = path.join(dir, 'update-request');
    await fs.writeFile(helper, 'unit');
    const fetchMock = vi.fn(async () => response({ tag_name: 'v1.1.0', html_url: 'https://example.test' }));
    const service = new UpdateService({ dataDir: dir, currentVersion: '1.0.0', updateHelperPath: helper, requestPath: request, fetchImpl: fetchMock as unknown as typeof fetch });
    await service.load();
    const status = await service.getStatus(true);
    expect(status).toMatchObject({ updateAvailable: true, applyAvailable: true });
    await service.requestApply();
    expect(JSON.parse(await fs.readFile(request, 'utf8'))).toMatchObject({ tag: 'v1.1.0' });
    await expect(service.requestApply()).rejects.toMatchObject({ code: 'update_already_requested' });
  });
});
