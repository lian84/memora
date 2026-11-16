import { memoraEnv } from './env.mjs';
// Consolidamento LLM esplicito e read-only. Non crea candidate o Markdown.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MemoryConsolidator,
  MemoryService,
  OpenCodeGoCuratorProvider,
  OpenRouterCuratorProvider,
} from '../packages/memory/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(repoRoot, memoraEnv('DATA_DIR') ?? './data');
const args = process.argv.slice(2);
const value = (name, fallback) => args.find(argument => argument.startsWith(`${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const maxRecords = Number(value('--max-records', 20));
const maxBatches = Number(value('--max-batches', 2));
const jsonPath = value('--json', '');
if (!Number.isSafeInteger(maxRecords) || maxRecords < 2 || maxRecords > 50) throw new Error('--max-records deve essere tra 2 e 50');
if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 20) throw new Error('--max-batches deve essere tra 1 e 20');

const providerName = memoraEnv('MEMORY_CURATOR_PROVIDER') ?? 'opencode-go';
const model = memoraEnv('MEMORY_CURATOR_MODEL');
const reasoning = memoraEnv('MEMORY_CURATOR_REASONING_LEVEL') ?? 'low';
if (!model) throw new Error('MEMORA_MEMORY_CURATOR_MODEL non impostato');
let apiKey = providerName === 'opencode-go' ? process.env.OPENCODE_API_KEY : process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  try {
    const secrets = JSON.parse(await fsp.readFile(path.join(dataDir, 'config', 'secrets.json'), 'utf8'));
    apiKey = secrets?.secrets?.[providerName];
  } catch {
    // Nessun contenuto del file viene stampato.
  }
}
if (!apiKey) throw new Error(`Credenziale assente per ${providerName}`);
if (providerName !== 'openrouter' && providerName !== 'opencode-go') throw new Error('Provider non supportato');

const provider = providerName === 'opencode-go'
  ? new OpenCodeGoCuratorProvider(model, apiKey, reasoning, 30_000)
  : new OpenRouterCuratorProvider(model, apiKey, { reasoningLevel: reasoning, timeoutMs: 30_000 });
const consolidator = new MemoryConsolidator(provider, { maxRecords });
const service = new MemoryService(dataDir, { searchMode: 'lexical', diversity: 0 });

try {
  await service.initialize();
  const active = await service.listActiveMemoryRecords();
  const groups = new Map();
  for (const record of active) {
    const key = record.project ?? record.relativePath;
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }
  const batches = [];
  for (const records of groups.values()) {
    if (records.length < 2) continue;
    for (let index = 0; index < records.length; index += maxRecords) {
      if (batches.length >= maxBatches) break;
      batches.push(records.slice(index, index + maxRecords));
    }
    if (batches.length >= maxBatches) break;
  }

  const reports = [];
  for (const batch of batches) {
    const report = await consolidator.analyze(batch.map(record => ({
      memoryId: record.memoryId,
      versionId: record.versionId,
      relativePath: record.relativePath,
      text: record.text,
      project: record.project,
      confidence: record.confidence,
      updatedAt: record.updatedAt,
    })));
    reports.push({
      ...report,
      decisions: report.decisions.map(decision => ({
        ...decision,
        records: decision.memoryIds.map(id => {
          const record = batch.find(item => item.memoryId === id);
          return record ? { memoryId: record.memoryId, relativePath: record.relativePath, text: record.text } : { memoryId: id };
        }),
      })),
    });
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    provider: providerName,
    model,
    activeRecords: active.length,
    batches: batches.length,
    decisions: reports.reduce((sum, item) => sum + item.decisions.length, 0),
    reports,
  };
  if (jsonPath) await fsp.writeFile(path.resolve(repoRoot, jsonPath), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    readOnly: true,
    provider: report.provider,
    model: report.model,
    activeRecords: report.activeRecords,
    batches: report.batches,
    decisions: report.decisions,
    kinds: reports.flatMap(item => item.decisions.map(decision => decision.kind)),
  }, null, 2));
  if (report.decisions > 0) console.log(`Report dettagliato: ${jsonPath || '(usa --json=percorso per salvarlo)'}`);
} finally {
  await service.close();
}
