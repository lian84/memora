import { memoraEnv } from './env.mjs';
// Verifica read-only di indice SQLite e metadata Markdown. Nessun contenuto.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryService, parseMemoryMetadata } from '../packages/memory/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(repoRoot, memoraEnv('DATA_DIR') ?? './data');
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

let metadataErrors = [];
let parsedRecords = 0;
for (const file of files) {
  const relativePath = path.relative(dataDir, file);
  const parsed = parseMemoryMetadata(await fsp.readFile(file, 'utf8'));
  parsedRecords += parsed.records.length;
  metadataErrors.push(...parsed.errors.map(error => ({ file: relativePath, line: error.line, code: error.code })));
}

const inboxFile = path.join(dataDir, 'memory-inbox', 'candidates.jsonl');
let candidateStats = { total: 0, pending: 0, conflict: 0, approved: 0, rejected: 0, approvalRate: null };
try {
  const latest = new Map();
  for (const line of (await fsp.readFile(inboxFile, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try {
      const candidate = JSON.parse(line);
      if (typeof candidate?.id === 'string' && typeof candidate?.status === 'string') latest.set(candidate.id, candidate);
    } catch {
      // una riga corrotta non blocca il controllo
    }
  }
  const values = [...latest.values()];
  const count = status => values.filter(candidate => candidate.status === status).length;
  const approved = count('approved');
  const rejected = count('rejected');
  candidateStats = {
    total: values.length,
    pending: count('pending'),
    conflict: count('conflict'),
    approved,
    rejected,
    approvalRate: approved + rejected === 0 ? null : Number((approved / (approved + rejected)).toFixed(3)),
  };
} catch {
  // Inbox non ancora creata.
}

const service = new MemoryService(dataDir, { searchMode: 'lexical' });
let integrity;
try {
  await service.initialize();
  integrity = await service.integrityCheck();
} finally {
  await service.close();
}
const ok = integrity.ok && integrity.foreignKeyViolations === 0 && metadataErrors.length === 0;
console.log(JSON.stringify({ ok, dataDir, integrity, memoryInbox: candidateStats, markdownFiles: files.length, parsedRecords, metadataErrors }, null, 2));
if (!ok) process.exitCode = 1;
