import { memoraEnv } from './env.mjs';
// Retention esplicita delle versioni superseded. Dry-run di default.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMemoryMetadata, parseMemoryMetadata, stripMemoryMetadataComment } from '../packages/memory/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(repoRoot, memoraEnv('DATA_DIR') ?? './data');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const backup = args.includes('--backup');
const daysArg = args.find(argument => argument.startsWith('--older-than-days='))?.split('=')[1]
  ?? memoraEnv('MEMORY_HISTORY_RETENTION_DAYS');
const days = Number(daysArg);
if (!Number.isFinite(days) || days <= 0) {
  throw new Error('Specifica --older-than-days=N (oppure MEMORA_MEMORY_HISTORY_RETENTION_DAYS)');
}
const cutoff = Date.now() - days * 86_400_000;
const files = [];

function walk(directory) {
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
}
for (const root of ['memory', 'projects']) walk(path.join(dataDir, root));

let changedFiles = 0;
let removedVersions = 0;
for (const file of files) {
  const content = await fsp.readFile(file, 'utf8');
  const parsed = parseMemoryMetadata(content);
  const byLine = new Map();
  for (const item of parsed.records) {
    const list = byLine.get(item.line) ?? [];
    list.push(item.record);
    byLine.set(item.line, list);
  }
  const remove = new Set();
  for (const [line, records] of byLine) {
    if (records.length > 0 && records.every(record => record.status === 'superseded' && record.updatedAt < cutoff)) remove.add(line);
  }
  if (remove.size === 0) continue;
  const removedIds = new Set();
  for (const [line, records] of byLine) {
    if (remove.has(line)) for (const record of records) removedIds.add(record.versionId);
  }
  const lines = content.split('\n');
  for (const [line, records] of byLine) {
    if (remove.has(line)) continue;
    const updated = records.map(record => ({
      ...record,
      supersedes: (record.supersedes ?? []).filter(versionId => !removedIds.has(versionId)),
    }));
    if (JSON.stringify(updated) === JSON.stringify(records)) continue;
    const original = lines[line - 1] ?? '';
    const text = stripMemoryMetadataComment(original).trimEnd();
    lines[line - 1] = `${text} ${updated.map(record => formatMemoryMetadata(record)).join(' ')}`;
  }
  const pruned = lines.filter((_line, index) => !remove.has(index + 1));
  changedFiles++;
  removedVersions += remove.size;
  if (apply) {
    const stat = await fsp.stat(file);
    if (backup) await fsp.copyFile(file, `${file}.bak-${Date.now()}`);
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
    await fsp.writeFile(temp, pruned.join('\n'), { mode: stat.mode & 0o777 });
    await fsp.rename(temp, file);
  }
}
console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  dataDir,
  olderThanDays: days,
  files: changedFiles,
  versions: removedVersions,
  backup,
}, null, 2));
if (!apply && removedVersions > 0) console.log('Esegui con --apply per rimuovere le versioni; aggiungi --backup per una copia.');
