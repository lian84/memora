import { memoraEnv } from './env.mjs';
// Migrazione non distruttiva: aggiunge solo commenti metadata ai bullet legacy.
// Dry-run di default; --apply scrive i file. Nessun contenuto viene stampato.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  annotateMemoryBullet,
  deriveLegacyMemoryRecord,
  stripMemoryMetadataComment,
} from '../packages/memory/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(repoRoot, memoraEnv('DATA_DIR') ?? './data');
const apply = process.argv.includes('--apply');
const backup = process.argv.includes('--backup');
const roots = ['memory', 'projects'];
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

for (const root of roots) walk(path.join(dataDir, root));

let changedFiles = 0;
let changedBullets = 0;
for (const file of files) {
  const relativePath = path.relative(dataDir, file).split(path.sep).join('/');
  const content = await fsp.readFile(file, 'utf8');
  const stat = await fsp.stat(file);
  const lines = content.split('\n');
  let fence;
  let changed = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence || !/^\s*[-*+]\s+\S/.test(line) || line.includes('<!-- memora-memory:v1')) continue;
    const text = stripMemoryMetadataComment(line).replace(/^\s*[-*+]\s+/, '').trim();
    const record = deriveLegacyMemoryRecord(relativePath, text, stat.mtimeMs, index);
    lines[index] = annotateMemoryBullet(line, record);
    changed++;
  }
  if (changed === 0) continue;
  changedFiles++;
  changedBullets += changed;
  if (apply) {
    if (backup) await fsp.copyFile(file, `${file}.bak-${Date.now()}`);
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
    await fsp.writeFile(temp, lines.join('\n'), { mode: stat.mode & 0o777 });
    await fsp.rename(temp, file);
  }
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  dataDir,
  files: changedFiles,
  bullets: changedBullets,
  backup,
}, null, 2));
if (!apply && changedBullets > 0) console.log('Esegui con --apply per scrivere i metadata; aggiungi --backup per una copia di sicurezza.');
