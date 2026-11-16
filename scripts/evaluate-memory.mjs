import { memoraEnv } from './env.mjs';
// Offline-first evaluation harness. Non usa dati personali e non invia nulla
// senza --curator=live esplicito.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  MemoryService,
  OpenCodeGoCuratorProvider,
  OpenRouterCuratorProvider,
  TransformersEmbeddingService,
  compareCuratorBaseline,
  compareRetrievalBaseline,
  computeCuratorMetrics,
  evaluateCuratorCases,
  evaluateRetrievalMode,
} from '../packages/memory/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evaluationDir = path.join(repoRoot, 'evaluation');
const args = process.argv.slice(2);
const flags = new Set(args.filter(argument => argument.startsWith('--') && !argument.includes('=')));
const options = Object.fromEntries(args.filter(argument => argument.startsWith('--') && argument.includes('=')).map(argument => {
  const index = argument.indexOf('=');
  return [argument.slice(2, index), argument.slice(index + 1)];
}));

const topK = Number(options['top-k'] ?? 10);
const maxChars = Number(options['max-chars'] ?? 50_000);
const tolerance = Number(options.tolerance ?? 0.02);
const datasetPath = path.resolve(repoRoot, options.dataset ?? 'evaluation/retrieval.json');
const curatorDatasetPath = path.resolve(repoRoot, options.curatorDataset ?? 'evaluation/curator.json');
const baselinePath = path.resolve(repoRoot, options.baseline ?? 'evaluation/baseline.json');
const outputPath = options.json ? path.resolve(repoRoot, options.json) : undefined;
const curatorMode = options.curator ?? 'replay';
const requestedModes = options.modes
  ? options.modes.split(',').map(mode => mode.trim()).filter(Boolean)
  : undefined;
const sourceDataDir = path.resolve(repoRoot, memoraEnv('DATA_DIR') ?? './data');
const sourceModels = path.join(sourceDataDir, 'models');
const modelAvailable = fs.existsSync(sourceModels);

if (!Number.isSafeInteger(topK) || topK < 1 || topK > 50) throw new Error('--top-k deve essere un intero tra 1 e 50');
if (!Number.isSafeInteger(maxChars) || maxChars < 500 || maxChars > 50_000) throw new Error('--max-chars deve essere un intero tra 500 e 50000');
if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) throw new Error('--tolerance deve essere tra 0 e 1');
if (curatorMode !== 'replay' && curatorMode !== 'live' && curatorMode !== 'skip') throw new Error('--curator deve essere replay, live o skip');
if (flags.has('--write-baseline') && curatorMode === 'live') throw new Error('La baseline deve essere riproducibile: usa --curator=replay');

const modes = requestedModes ?? (modelAvailable ? ['lexical', 'semantic', 'hybrid'] : ['lexical']);
for (const mode of modes) {
  if (mode !== 'lexical' && mode !== 'semantic' && mode !== 'hybrid') throw new Error(`Modalità non valida: ${mode}`);
}
if (modes.some(mode => mode !== 'lexical') && !modelAvailable) {
  throw new Error(`Modello embedding assente in ${sourceModels}. Esegui pnpm embeddings:setup o imposta MEMORA_DATA_DIR.`);
}

const retrievalDataset = JSON.parse(await fsp.readFile(datasetPath, 'utf8'));
const curatorDataset = curatorMode === 'skip'
  ? { cases: [] }
  : JSON.parse(await fsp.readFile(curatorDatasetPath, 'utf8'));

class ReplayProvider {
  model = 'evaluation-replay';
  provider = 'openrouter';
  constructor(output) { this.output = output; }
  async analyze() {
    if (this.output === null) throw new Error('unexpected replay provider call');
    return this.output;
  }
}

function liveProviderFactory() {
  const provider = memoraEnv('MEMORY_CURATOR_PROVIDER') ?? 'openrouter';
  const model = memoraEnv('MEMORY_CURATOR_MODEL');
  const reasoning = memoraEnv('MEMORY_CURATOR_REASONING_LEVEL') ?? 'low';
  if (!model) throw new Error('MEMORA_MEMORY_CURATOR_MODEL non impostato per --curator=live');
  let key = provider === 'opencode-go' ? process.env.OPENCODE_API_KEY : process.env.OPENROUTER_API_KEY;
  if (!key) {
    try {
      const secrets = JSON.parse(fs.readFileSync(path.join(sourceDataDir, 'config', 'secrets.json'), 'utf8'));
      key = secrets?.secrets?.[provider];
    } catch {
      // Il messaggio non include mai il contenuto del file.
    }
  }
  if (!key) throw new Error(`Credenziale assente per ${provider}`);
  return () => provider === 'opencode-go'
    ? new OpenCodeGoCuratorProvider(model, key, reasoning, 30_000)
    : new OpenRouterCuratorProvider(model, key, { reasoningLevel: reasoning, timeoutMs: 30_000 });
}

async function writeDataset(directory) {
  for (const document of retrievalDataset.documents) {
    const target = path.resolve(directory, document.path);
    if (!target.startsWith(`${directory}${path.sep}`)) throw new Error(`Percorso dataset non valido: ${document.path}`);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, document.content);
  }
}

const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'memora-eval-'));
try {
  await writeDataset(tempDir);
  let embeddingProvider;
  if (modes.some(mode => mode !== 'lexical')) {
    await fsp.symlink(sourceModels, path.join(tempDir, 'models'), 'dir');
    embeddingProvider = new TransformersEmbeddingService(tempDir, {
      model: memoraEnv('EMBEDDING_MODEL') ?? DEFAULT_EMBEDDING_MODEL,
      dimensions: Number(memoraEnv('EMBEDDING_DIMENSIONS') ?? DEFAULT_EMBEDDING_DIMENSIONS),
    });
  }
  const service = new MemoryService(tempDir, { embeddings: embeddingProvider, searchMode: 'lexical' });
  try {
    await service.initialize();
    await service.reindex();
    if (embeddingProvider && !embeddingProvider.isAvailable()) throw new Error('Embedding provider non disponibile');
    for (const mode of modes) {
      if (mode === 'lexical') await service.searchLexical('warmup', { topK });
      else if (mode === 'semantic') await service.searchSemantic('warmup', { topK });
      else await service.searchHybrid('warmup', { topK });
    }

    const retrieval = {};
    for (const mode of modes) {
      retrieval[mode] = await evaluateRetrievalMode(retrievalDataset, mode, service, { topK, maxChars });
    }

    let curator;
    if (curatorMode !== 'skip') {
      const providerFactory = curatorMode === 'live'
        ? liveProviderFactory()
        : testCase => new ReplayProvider(testCase.providerOutput);
      const results = await evaluateCuratorCases(curatorDataset.cases, providerFactory, {
        minConfidence: Number(memoraEnv('MEMORY_CURATOR_MIN_CONFIDENCE') ?? 0.75),
        minSalience: Number(memoraEnv('MEMORY_CURATOR_MIN_SALIENCE') ?? 0.70),
      });
      curator = { mode: curatorMode, metrics: computeCuratorMetrics(results), results };
    }

    const config = {
      topK,
      maxChars,
      embedding: embeddingProvider?.getModelInfo() ?? null,
    };
    const report = {
      version: 1,
      dataset: retrievalDataset.name ?? path.basename(datasetPath),
      generatedAt: new Date().toISOString(),
      config,
      retrieval: Object.fromEntries(Object.entries(retrieval).map(([mode, result]) => [mode, result.aggregate])),
      curator: curator ? { mode: curator.mode, metrics: curator.metrics } : null,
    };

    if (flags.has('--write-baseline')) {
      await fsp.writeFile(baselinePath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
      console.log(`Baseline scritta: ${path.relative(repoRoot, baselinePath)}`);
    }

    const regressions = [];
    if (flags.has('--check')) {
      if (!fs.existsSync(baselinePath)) throw new Error(`Baseline assente: ${path.relative(repoRoot, baselinePath)}`);
      const baseline = JSON.parse(await fsp.readFile(baselinePath, 'utf8'));
      regressions.push(...compareRetrievalBaseline(report.retrieval, baseline.retrieval ?? {}, tolerance));
      if (curator && baseline.curator?.mode === curator.mode) {
        regressions.push(...compareCuratorBaseline(curator.metrics, baseline.curator.metrics, tolerance));
      }
      if (regressions.length > 0) {
        console.error('Regressioni rispetto alla baseline:');
        for (const regression of regressions) {
          console.error(`- ${regression.metric}: ${regression.baseline.toFixed(4)} -> ${regression.current.toFixed(4)} (${regression.delta.toFixed(4)})`);
        }
      } else {
        console.log(`Baseline OK (tolleranza ${tolerance.toFixed(2)})`);
      }
    }

    const summary = {
      dataset: report.dataset,
      config,
      retrieval: Object.fromEntries(Object.entries(retrieval).map(([mode, result]) => [mode, {
        queries: result.aggregate.queries,
        recallAt: result.aggregate.recallAt,
        precisionAt: result.aggregate.precisionAt,
        ndcgAt: result.aggregate.ndcgAt,
        recallAt10: result.aggregate.recallAt[10],
        precisionAt10: result.aggregate.precisionAt[10],
        ndcgAt10: result.aggregate.ndcgAt[10],
        mrr: result.aggregate.mrr,
        latencyP50Ms: result.aggregate.latencyP50Ms,
        latencyP95Ms: result.aggregate.latencyP95Ms,
        contextCharsMean: result.aggregate.contextCharsMean,
        estimatedTokensMean: result.aggregate.estimatedTokensMean,
      }])),
      curator: curator ? {
        mode: curator.mode,
        total: curator.metrics.total,
        accuracy: curator.metrics.accuracy,
        macroF1: curator.metrics.macroF1,
        updateIntentAccuracy: curator.metrics.updateIntentAccuracy,
        rejected: curator.metrics.rejected,
        errored: curator.metrics.errored,
        falsePositives: curator.metrics.falsePositives,
        falseNegatives: curator.metrics.falseNegatives,
        byClass: Object.fromEntries(Object.entries(curator.metrics.byClass).map(([action, metric]) => [action, {
          support: metric.support, precision: metric.precision, recall: metric.recall, f1: metric.f1,
        }])),
      } : null,
      baseline: flags.has('--check') ? { regressions } : undefined,
    };
    console.log(JSON.stringify(summary, null, 2));

    if (outputPath) {
      const fullReport = {
        ...report,
        retrievalQueries: Object.fromEntries(Object.entries(retrieval).map(([mode, result]) => [mode, result.queries])),
        curatorResults: curator?.results,
      };
      await fsp.writeFile(outputPath, `${JSON.stringify(fullReport, null, 2)}\n`, { mode: 0o644 });
      console.log(`Report scritto: ${path.relative(repoRoot, outputPath)}`);
    }
    if (regressions.length > 0) process.exitCode = 1;
  } finally {
    await service.close();
  }
} finally {
  await fsp.rm(tempDir, { recursive: true, force: true });
}
