import { memoraEnv } from './env.mjs';
// Audit di consolidamento deterministico: nessuna scrittura e nessun LLM.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryService } from '../packages/memory/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(repoRoot, memoraEnv('DATA_DIR') ?? './data');
const args = process.argv.slice(2);
const minSimilarity = Number(args.find(argument => argument.startsWith('--min-similarity='))?.split('=')[1] ?? 0.82);
if (!Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1) throw new Error('--min-similarity deve essere tra 0 e 1');

function tokens(text) {
  return new Set((text.toLocaleLowerCase('it-IT').match(/[\p{L}\p{N}]+/gu) ?? []).filter(token => token.length >= 3));
}
function similarity(a, b) {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 1 : shared / union;
}

const service = new MemoryService(dataDir, { searchMode: 'lexical', diversity: 0 });
try {
  await service.initialize();
  const records = await service.listActiveMemoryRecords();
  const tokenSets = records.map(record => tokens(`${record.text} ${record.project ?? ''}`));
  const pairs = [];
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (records[i].memoryId === records[j].memoryId) continue;
      const score = similarity(tokenSets[i], tokenSets[j]);
      if (score >= minSimilarity) pairs.push({ a: records[i].memoryId, b: records[j].memoryId, path: records[i].relativePath, score: Number(score.toFixed(3)) });
    }
  }
  const report = {
    dataDir,
    activeRecords: records.length,
    duplicatePairs: pairs.length,
    duplicatePaths: [...new Set(pairs.map(pair => pair.path))].length,
    minSimilarity,
    pairs: pairs.slice(0, 50),
    note: 'Audit read-only. Nessuna proposta o modifica viene creata.',
  };
  const output = args.find(argument => argument.startsWith('--json='))?.slice('--json='.length);
  if (output) await fsp.writeFile(path.resolve(repoRoot, output), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...report, pairs: report.pairs.map(pair => ({ score: pair.score, path: pair.path })) }, null, 2));
} finally {
  await service.close();
}
