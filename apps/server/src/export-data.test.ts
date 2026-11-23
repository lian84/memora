import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { DataExportService } from './export-data.js';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];
async function fixture(): Promise<{ dataDir: string; exportDir: string; service: DataExportService }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-export-'));
  dirs.push(root);
  const dataDir = path.join(root, 'data');
  const exportDir = path.join(root, 'exports');
  await fs.mkdir(path.join(dataDir, 'memory'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'config'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'models'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'memory', 'note.md'), '# Nota\n');
  await fs.writeFile(path.join(dataDir, 'config', 'secrets.json'), '{"secret":"no"}');
  await fs.writeFile(path.join(dataDir, 'models', 'large.bin'), 'model');
  const service = new DataExportService({ dataDir, appVersion: 'test', env: { MEMORA_EXPORT_DIR: exportDir } });
  await service.initialize();
  return { dataDir, exportDir, service };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('DataExportService', () => {
  it('crea un export leggibile senza config, modelli o segreti', async () => {
    const { exportDir, service } = await fixture();
    const record = await service.create();
    expect(record.size).toBeGreaterThan(0);
    expect((await fs.stat(path.join(exportDir, record.filename))).mode & 0o777).toBe(0o600);
    const listing = (await execFileAsync('tar', ['-tzf', path.join(exportDir, record.filename)])).stdout;
    expect(listing).toContain('memory/note.md');
    expect(listing).not.toContain('config/secrets.json');
    expect(listing).not.toContain('models/large.bin');
    expect(listing).toContain('export-manifest.json');
    expect((await service.getStatus()).exports[0]?.id).toBe(record.id);
  });

  it('elimina export e mantiene la retention', async () => {
    const { service } = await fixture();
    const records = [];
    for (let i = 0; i < 6; i += 1) records.push(await service.create());
    const exports = await service.list();
    expect(exports).toHaveLength(5);
    await service.delete(records[5]!.id);
    expect(await service.list()).toHaveLength(4);
  });
});
