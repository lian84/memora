import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryService,
  compareCuratorBaseline,
  compareRetrievalBaseline,
  computeCuratorMetrics,
  computeRetrievalMetrics,
  evaluateCuratorCases,
  evaluateRetrievalMode,
  type CuratorEvaluationCase,
  type MemoryCuratorProvider,
  type RetrievalDataset,
} from './index.js';

const evaluationDir = fileURLToPath(new URL('../../../evaluation/', import.meta.url));
const retrievalDataset = JSON.parse(fs.readFileSync(path.join(evaluationDir, 'retrieval.json'), 'utf8')) as RetrievalDataset;
const curatorDataset = JSON.parse(fs.readFileSync(path.join(evaluationDir, 'curator.json'), 'utf8')) as { cases: CuratorEvaluationCase[] };
const baseline = JSON.parse(fs.readFileSync(path.join(evaluationDir, 'baseline.json'), 'utf8'));

class ReplayProvider implements MemoryCuratorProvider {
  readonly model = 'evaluation-replay';
  readonly provider = 'openrouter';
  calls = 0;
  constructor(private readonly output: unknown) {}
  async analyze() {
    this.calls++;
    if (this.output === null) throw new Error('unexpected provider call');
    return this.output;
  }
}

describe('memory evaluation metrics', () => {
  it('calcola recall, precision, MRR e nDCG su chunk ed evidenze', () => {
    const metrics = computeRetrievalMetrics([
      { relativePath: 'a.md', heading: 'H', content: 'alpha beta' },
      { relativePath: 'b.md', heading: null, content: 'gamma' },
      { relativePath: 'a.md', heading: 'G', content: 'delta' },
    ], [
      { id: 'a-h', path: 'a.md', heading: 'H', terms: ['alpha'], weight: 3 },
      { id: 'b', path: 'b.md', terms: ['gamma'], weight: 2 },
      { id: 'a-g', path: 'a.md', heading: 'G', terms: ['delta'], weight: 1 },
    ], [1, 2, 3]);
    expect(metrics.recallAt).toMatchObject({ 1: 1 / 3, 2: 2 / 3, 3: 1 });
    expect(metrics.precisionAt[1]).toBe(1);
    expect(metrics.mrr).toBe(1);
    expect(metrics.firstRelevantRank).toBe(1);
    expect(metrics.matchedIds).toEqual(['a-h', 'b', 'a-g']);
    expect(metrics.ndcgAt[3]).toBeCloseTo(1);
    expect(metrics.estimatedTokens).toBe(Math.ceil('alpha betagammadelta'.length / 4));
  });

  it('non considera rilevante un heading diverso', () => {
    const metrics = computeRetrievalMetrics([
      { relativePath: 'a.md', heading: 'Altro', content: 'alpha' },
    ], [{ id: 'x', path: 'a.md', heading: 'H', terms: ['alpha'] }]);
    expect(metrics.mrr).toBe(0);
    expect(metrics.missingIds).toEqual(['x']);
  });

  it('confronta la baseline con una tolleranza esplicita', () => {
    const baseline = {
      lexical: { recallAt: { 10: 0.9 }, precisionAt: { 10: 0.3 }, ndcgAt: { 10: 0.8 }, mrr: 0.7 },
    } as never;
    const current = {
      lexical: { recallAt: { 10: 0.85 }, precisionAt: { 10: 0.3 }, ndcgAt: { 10: 0.8 }, mrr: 0.65 },
    } as never;
    expect(compareRetrievalBaseline(current, baseline, 0.02)).toHaveLength(2);
    expect(compareRetrievalBaseline(current, baseline, 0.06)).toHaveLength(0);
  });

  it('calcola precisione, recall e matrice di confusione del Curator', () => {
    const metrics = computeCuratorMetrics([
      { id: '1', expectedAction: 'new', actualAction: 'new', correct: true, rejected: false, errored: false, providerCalls: 1, events: [] },
      { id: '2', expectedAction: 'update', actualAction: 'none', expectedUpdateIntent: 'augment', correct: false, updateIntentCorrect: false, rejected: true, errored: false, providerCalls: 1, events: [] },
      { id: '3', expectedAction: 'none', actualAction: 'new', correct: false, rejected: false, errored: false, providerCalls: 1, events: [] },
    ]);
    expect(metrics.accuracy).toBeCloseTo(1 / 3);
    expect(metrics.rejected).toBe(1);
    expect(metrics.falsePositives).toBe(1);
    expect(metrics.falseNegatives).toBe(1);
    expect(metrics.byClass.new.precision).toBe(0.5);
    expect(metrics.byClass.new.recall).toBe(1);
    expect(metrics.byClass.update.recall).toBe(0);
    expect(metrics.byClass.none.precision).toBe(0);
    expect(metrics.confusion.update.none).toBe(1);
    expect(metrics.updateIntentAccuracy).toBe(0);
    expect(compareCuratorBaseline(metrics, { ...metrics, accuracy: 0.8 }, 0.02)).toHaveLength(1);
  });

  it('esegue il dataset Curator in replay senza rete', async () => {
    const results = await evaluateCuratorCases(curatorDataset.cases, testCase => new ReplayProvider(testCase.providerOutput));
    const metrics = computeCuratorMetrics(results);
    expect(results).toHaveLength(curatorDataset.cases.length);
    expect(metrics.correct).toBe(curatorDataset.cases.length - 1);
    expect(metrics.accuracy).toBeCloseTo((curatorDataset.cases.length - 1) / curatorDataset.cases.length);
    expect(results.find(result => result.id === 'secret-blocks-provider')?.providerCalls).toBe(0);
    expect(results.find(result => result.id === 'augment-drops-fact')?.actualAction).toBe('none');
    expect(results.find(result => result.id === 'pii-output-rejected')?.actualAction).toBe('none');
    expect(metrics.accuracy).toBeCloseTo(baseline.curator.metrics.accuracy, 6);
    expect(metrics.macroF1).toBeCloseTo(baseline.curator.metrics.macroF1, 6);
    expect(metrics.updateIntentAccuracy).toBeCloseTo(baseline.curator.metrics.updateIntentAccuracy, 6);
  });
});

describe('memory retrieval evaluation integration', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('esegue il dataset sintetico in modalità lexical', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-evaluation-'));
    dirs.push(dir);
    for (const document of retrievalDataset.documents) {
      const target = path.join(dir, document.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, document.content);
    }
    const service = new MemoryService(dir, { searchMode: 'lexical' });
    try {
      await service.initialize();
      await service.reindex();
      const result = await evaluateRetrievalMode(retrievalDataset, 'lexical', service, { topK: 10, maxChars: 100_000 });
      expect(result.aggregate.queries).toBe(retrievalDataset.queries.length);
      expect(result.queries.every(query => query.resultCount > 0)).toBe(true);
      expect(result.aggregate.recallAt[10]).toBeGreaterThan(0.5);
      expect(result.queries.find(query => query.queryId === 'atlas-code-exact')?.firstRelevantRank).toBe(1);
      expect(compareRetrievalBaseline({ lexical: result.aggregate }, { lexical: baseline.retrieval.lexical }, 0.02)).toEqual([]);
    } finally {
      await service.close();
    }
  });
});
