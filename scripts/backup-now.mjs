#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.MEMORA_DATA_DIR ?? './data');
const appVersion = process.env.MEMORA_VERSION ?? (JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))).version ?? '0.0.0';

const { BackupService } = await import(path.join(root, 'apps/server/dist/backup.js'));
const service = new BackupService({
  dataDir,
  appVersion,
  env: process.env,
  isIdle: () => true,
  log: (event, details) => console.error(JSON.stringify({ event, ...(details ?? {}) })),
});
await service.load();
const record = await service.createBackup('manual');
console.log(JSON.stringify({ ok: true, archive: path.join(service.backupDir, record.archiveName), ...record }, null, 2));
