import { performance } from 'node:perf_hooks';
import type { MemoryTurnInput } from '@memora/shared';
import {
  MemoryCurator,
  type CuratorDiagnostic,
  type MemoryCuratorProvider,
} from './curator.js';

export type RetrievalMode = 'lexical' | 'semantic' | 'hybrid';

export interface RetrievalEvidence {
  id: string;
  path: string;
  heading?: string | null;
  /** Tutti i termini devono comparire nel chunk recuperato. */
  terms?: string[];
  /** Guadagno per nDCG, da 1 a 3. Default 1. */
  weight?: number;
}

export interface RetrievalQuery {
  id: string;
  query: string;
  relevant: RetrievalEvidence[];
  tags?: string[];
}

export interface RetrievalDocument {
  path: string;
  content: string;
}

export interface RetrievalDataset {
  version: number;
  name?: string;
  documents: RetrievalDocument[];
  queries: RetrievalQuery[];
}

export interface RetrievalSearchResult {
  relativePath: string;
  heading: string | null;
  content: string;
}

export interface RetrievalSearcher {
  searchLexical(query: string, options?: { topK?: number; maxChars?: number }): Promise<RetrievalSearchResult[]>;
  searchSemantic(query: string, options?: { topK?: number; maxChars?: number }): Promise<RetrievalSearchResult[]>;
  searchHybrid(query: string, options?: { topK?: number; maxChars?: number }): Promise<RetrievalSearchResult[]>;
}

export interface RetrievalMetricSet {
  recallAt: Record<number, number>;
  precisionAt: Record<number, number>;
  ndcgAt: Record<number, number>;
  mrr: number;
}

export interface RetrievalQueryMetrics extends RetrievalMetricSet {
  queryId: string;
  query: string;
  firstRelevantRank: number | null;
  resultCount: number;
  relevantCount: number;
  matchedIds: string[];
  missingIds: string[];
  contextChars: number;
  estimatedTokens: number;
  latencyMs: number;
}

export interface RetrievalAggregate extends RetrievalMetricSet {
  queries: number;
  latencyMeanMs: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  contextCharsMean: number;
  estimatedTokensMean: number;
}

export interface RetrievalModeResult {
  mode: RetrievalMode;
  aggregate: RetrievalAggregate;
  queries: RetrievalQueryMetrics[];
}

export interface CuratorEvaluationMemory {
  sourceId?: string;
  path: string;
  heading?: string | null;
  content: string;
}

export type CuratorClass = 'new' | 'update' | 'duplicate' | 'conflict' | 'none';
export const CURATOR_CLASSES: readonly CuratorClass[] = ['new', 'update', 'duplicate', 'conflict', 'none'];

export interface CuratorEvaluationCase {
  id: string;
  description?: string;
  memory: CuratorEvaluationMemory[];
  userText: string;
  recentUserMessages?: string[];
  explicit?: boolean;
  expected: {
    action: CuratorClass;
    updateIntent?: string;
    targetPath?: string;
    memoryType?: string;
  };
  /** Usato solo dalla modalità replay offline. */
  providerOutput?: unknown;
}

export interface CuratorCaseResult {
  id: string;
  expectedAction: CuratorClass;
  actualAction: CuratorClass;
  expectedUpdateIntent?: string;
  actualUpdateIntent?: string;
  correct: boolean;
  updateIntentCorrect?: boolean;
  rejected: boolean;
  errored: boolean;
  providerCalls: number;
  actualTargetPath?: string;
  actualMemoryType?: string;
  events: string[];
}

export interface CuratorClassMetric {
  support: number;
  predicted: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface CuratorEvaluationMetrics {
  total: number;
  correct: number;
  accuracy: number;
  rejected: number;
  errored: number;
  falsePositives: number;
  falseNegatives: number;
  macroF1: number;
  updateIntentAccuracy: number | null;
  updateIntentSupport: number;
  byClass: Record<CuratorClass, CuratorClassMetric>;
  confusion: Record<CuratorClass, Record<CuratorClass, number>>;
}

export interface MetricRegression {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
}

const DEFAULT_K_VALUES = [1, 3, 5, 10] as const;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('it-IT')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesRetrievalEvidence(result: RetrievalSearchResult, evidence: RetrievalEvidence): boolean {
  if (result.relativePath !== evidence.path) return false;
  if (evidence.heading && normalize(result.heading ?? '') !== normalize(evidence.heading)) return false;
  if (evidence.terms?.length) {
    const content = normalize(result.content);
    if (!evidence.terms.every(term => content.includes(normalize(term)))) return false;
  }
  return true;
}

function evidenceWeight(evidence: RetrievalEvidence): number {
  const weight = evidence.weight ?? 1;
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

export function computeRetrievalMetrics(
  results: RetrievalSearchResult[],
  relevant: RetrievalEvidence[],
  kValues: readonly number[] = DEFAULT_K_VALUES,
): RetrievalMetricSet & { firstRelevantRank: number | null; matchedIds: string[]; missingIds: string[]; contextChars: number; estimatedTokens: number } {
  const ranks = new Map<string, number>();
  results.forEach((result, index) => {
    for (const evidence of relevant) {
      if (!ranks.has(evidence.id) && matchesRetrievalEvidence(result, evidence)) {
        ranks.set(evidence.id, index + 1);
      }
    }
  });

  const total = relevant.length;
  const recallAt: Record<number, number> = {};
  const precisionAt: Record<number, number> = {};
  const ndcgAt: Record<number, number> = {};
  const sortedWeights = relevant.map(evidenceWeight).sort((a, b) => b - a);

  for (const k of [...kValues].sort((a, b) => a - b)) {
    const matched = relevant.filter(evidence => (ranks.get(evidence.id) ?? Infinity) <= k).length;
    recallAt[k] = total === 0 ? 1 : matched / total;
    precisionAt[k] = matched / k;
    const dcg = relevant.reduce((sum, evidence) => {
      const rank = ranks.get(evidence.id);
      return rank !== undefined && rank <= k ? sum + evidenceWeight(evidence) / Math.log2(rank + 1) : sum;
    }, 0);
    const idcg = sortedWeights.slice(0, k).reduce((sum, weight, index) => sum + weight / Math.log2(index + 2), 0);
    ndcgAt[k] = idcg === 0 ? 1 : dcg / idcg;
  }

  const contextChars = results.reduce((sum, result) => sum + result.content.length, 0);
  const ranked = [...ranks.values()];
  return {
    recallAt,
    precisionAt,
    ndcgAt,
    mrr: ranked.length > 0 ? 1 / Math.min(...ranked) : 0,
    firstRelevantRank: ranked.length > 0 ? Math.min(...ranked) : null,
    matchedIds: relevant.filter(evidence => ranks.has(evidence.id)).map(evidence => evidence.id),
    missingIds: relevant.filter(evidence => !ranks.has(evidence.id)).map(evidence => evidence.id),
    contextChars,
    estimatedTokens: Math.ceil(contextChars / 4),
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]!;
}

export function aggregateRetrievalMetrics(queries: RetrievalQueryMetrics[]): RetrievalAggregate {
  const kValues = [...new Set(queries.flatMap(query => Object.keys(query.recallAt).map(Number)))].sort((a, b) => a - b);
  const averageAt = (selector: (query: RetrievalQueryMetrics) => Record<number, number>) =>
    Object.fromEntries(kValues.map(k => [k, mean(queries.map(query => selector(query)[k] ?? 0))]));
  const latency = queries.map(query => query.latencyMs);
  return {
    queries: queries.length,
    recallAt: averageAt(query => query.recallAt),
    precisionAt: averageAt(query => query.precisionAt),
    ndcgAt: averageAt(query => query.ndcgAt),
    mrr: mean(queries.map(query => query.mrr)),
    latencyMeanMs: mean(latency),
    latencyP50Ms: percentile(latency, 0.5),
    latencyP95Ms: percentile(latency, 0.95),
    contextCharsMean: mean(queries.map(query => query.contextChars)),
    estimatedTokensMean: mean(queries.map(query => query.estimatedTokens)),
  };
}

export async function evaluateRetrievalMode(
  dataset: RetrievalDataset,
  mode: RetrievalMode,
  searcher: RetrievalSearcher,
  options: { topK?: number; maxChars?: number; kValues?: readonly number[] } = {},
): Promise<RetrievalModeResult> {
  const topK = options.topK ?? 10;
  const maxChars = options.maxChars ?? 100_000;
  const kValues = options.kValues ?? DEFAULT_K_VALUES;
  const search = mode === 'lexical'
    ? searcher.searchLexical.bind(searcher)
    : mode === 'semantic'
      ? searcher.searchSemantic.bind(searcher)
      : searcher.searchHybrid.bind(searcher);
  const queries: RetrievalQueryMetrics[] = [];
  for (const query of dataset.queries) {
    const started = performance.now();
    const results = await search(query.query, { topK, maxChars });
    const latencyMs = performance.now() - started;
    queries.push({
      queryId: query.id,
      query: query.query,
      ...computeRetrievalMetrics(results, query.relevant, kValues),
      resultCount: results.length,
      relevantCount: query.relevant.length,
      latencyMs,
    });
  }
  return { mode, aggregate: aggregateRetrievalMetrics(queries), queries };
}

function qualityMetrics(metrics: RetrievalAggregate): Array<[string, number]> {
  const values: Array<[string, number]> = [['mrr', metrics.mrr]];
  for (const [k, value] of Object.entries(metrics.recallAt)) values.push([`recall@${k}`, value]);
  for (const [k, value] of Object.entries(metrics.precisionAt)) values.push([`precision@${k}`, value]);
  for (const [k, value] of Object.entries(metrics.ndcgAt)) values.push([`ndcg@${k}`, value]);
  return values;
}

export function compareRetrievalBaseline(
  current: Partial<Record<RetrievalMode, RetrievalAggregate>>,
  baseline: Partial<Record<RetrievalMode, RetrievalAggregate>>,
  tolerance = 0.02,
): MetricRegression[] {
  const regressions: MetricRegression[] = [];
  for (const mode of ['lexical', 'semantic', 'hybrid'] as const) {
    const before = baseline[mode];
    const after = current[mode];
    if (!before || !after) continue;
    const beforeMetrics = new Map(qualityMetrics(before));
    for (const [metric, value] of qualityMetrics(after)) {
      const base = beforeMetrics.get(metric);
      if (base === undefined) continue;
      if (value < base - tolerance) regressions.push({ metric: `${mode}.${metric}`, baseline: base, current: value, delta: value - base });
    }
  }
  return regressions;
}

function emptyClassMetrics(): Record<CuratorClass, CuratorClassMetric> {
  return Object.fromEntries(CURATOR_CLASSES.map(action => [action, {
    support: 0, predicted: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0,
    precision: 0, recall: 0, f1: 0,
  }])) as Record<CuratorClass, CuratorClassMetric>;
}

function emptyConfusion(): Record<CuratorClass, Record<CuratorClass, number>> {
  return Object.fromEntries(CURATOR_CLASSES.map(expected => [expected,
    Object.fromEntries(CURATOR_CLASSES.map(actual => [actual, 0])),
  ])) as Record<CuratorClass, Record<CuratorClass, number>>;
}

export async function evaluateCuratorCases(
  cases: CuratorEvaluationCase[],
  providerFactory: (testCase: CuratorEvaluationCase) => MemoryCuratorProvider,
  options: { minConfidence?: number; minSalience?: number } = {},
): Promise<CuratorCaseResult[]> {
  const results: CuratorCaseResult[] = [];
  for (const testCase of cases) {
    const events: string[] = [];
    let providerCalls = 0;
    const provider = providerFactory(testCase);
    const wrappedProvider: MemoryCuratorProvider = {
      get model() { return provider.model; },
      get provider() { return provider.provider; },
      analyze(input, report) {
        providerCalls++;
        return provider.analyze(input, report);
      },
      setReasoningLevel(level) {
        provider.setReasoningLevel?.(level);
      },
    };
    const search = {
      search: async () => testCase.memory.map((memory, index) => ({
        sourceId: memory.sourceId ?? `evaluation-${index}`,
        relativePath: memory.path,
        heading: memory.heading ?? null,
        content: memory.content,
        score: 1,
      })),
    };
    const curator = new MemoryCurator(wrappedProvider, search, {
      auto: true,
      minConfidence: options.minConfidence,
      minSalience: options.minSalience,
      log: (event: CuratorDiagnostic) => events.push(event.event),
    });
    const input: MemoryTurnInput = {
      sessionId: `evaluation-${testCase.id}`,
      userText: testCase.userText,
      recentUserMessages: testCase.recentUserMessages,
    };
    let actual: Awaited<ReturnType<MemoryCurator['curate']>> = null;
    let errored = false;
    try {
      actual = await curator.curate(input, testCase.explicit ?? false);
    } catch {
      errored = true;
    }
    const actualAction: CuratorClass = actual?.action ?? 'none';
    const updateIntentCorrect = testCase.expected.updateIntent === undefined
      ? undefined
      : actual?.updateIntent === testCase.expected.updateIntent;
    const correct = actualAction === testCase.expected.action
      && (testCase.expected.targetPath === undefined || actual?.targetPath === testCase.expected.targetPath)
      && (testCase.expected.memoryType === undefined || actual?.memoryType === testCase.expected.memoryType)
      && (updateIntentCorrect ?? true);
    results.push({
      id: testCase.id,
      expectedAction: testCase.expected.action,
      actualAction,
      expectedUpdateIntent: testCase.expected.updateIntent,
      actualUpdateIntent: actual?.updateIntent,
      correct,
      updateIntentCorrect,
      rejected: testCase.expected.action !== 'none' && actualAction === 'none',
      errored,
      providerCalls,
      actualTargetPath: actual?.targetPath,
      actualMemoryType: actual?.memoryType,
      events,
    });
  }
  return results;
}

export function computeCuratorMetrics(results: CuratorCaseResult[]): CuratorEvaluationMetrics {
  const byClass = emptyClassMetrics();
  const confusion = emptyConfusion();
  for (const result of results) {
    confusion[result.expectedAction][result.actualAction]++;
    byClass[result.expectedAction].support++;
    byClass[result.actualAction].predicted++;
  }
  for (const action of CURATOR_CLASSES) {
    const metric = byClass[action];
    metric.truePositives = confusion[action][action];
    metric.falsePositives = CURATOR_CLASSES.reduce((sum, expected) => expected === action ? sum : sum + confusion[expected][action], 0);
    metric.falseNegatives = CURATOR_CLASSES.reduce((sum, actual) => actual === action ? sum : sum + confusion[action][actual], 0);
    metric.precision = metric.predicted === 0 ? 0 : metric.truePositives / metric.predicted;
    metric.recall = metric.support === 0 ? 0 : metric.truePositives / metric.support;
    metric.f1 = metric.precision + metric.recall === 0 ? 0 : (2 * metric.precision * metric.recall) / (metric.precision + metric.recall);
  }
  const updateResults = results.filter(result => result.expectedUpdateIntent !== undefined);
  const classesWithSupport = CURATOR_CLASSES.filter(action => byClass[action].support > 0);
  return {
    total: results.length,
    correct: results.filter(result => result.correct).length,
    accuracy: results.length === 0 ? 0 : results.filter(result => result.correct).length / results.length,
    rejected: results.filter(result => result.rejected).length,
    errored: results.filter(result => result.errored).length,
    falsePositives: results.filter(result => result.expectedAction === 'none' && result.actualAction !== 'none').length,
    falseNegatives: results.filter(result => result.expectedAction !== 'none' && result.actualAction === 'none').length,
    macroF1: mean(classesWithSupport.map(action => byClass[action].f1)),
    updateIntentAccuracy: updateResults.length === 0 ? null : updateResults.filter(result => result.updateIntentCorrect === true).length / updateResults.length,
    updateIntentSupport: updateResults.length,
    byClass,
    confusion,
  };
}

export function compareCuratorBaseline(
  current: CuratorEvaluationMetrics,
  baseline: CuratorEvaluationMetrics,
  tolerance = 0.02,
): MetricRegression[] {
  const regressions: MetricRegression[] = [];
  for (const metric of ['accuracy', 'macroF1'] as const) {
    if (current[metric] < baseline[metric] - tolerance) {
      regressions.push({ metric: `curator.${metric}`, baseline: baseline[metric], current: current[metric], delta: current[metric] - baseline[metric] });
    }
  }
  if (current.updateIntentAccuracy !== null && baseline.updateIntentAccuracy !== null
    && current.updateIntentAccuracy < baseline.updateIntentAccuracy - tolerance) {
    regressions.push({
      metric: 'curator.updateIntentAccuracy',
      baseline: baseline.updateIntentAccuracy,
      current: current.updateIntentAccuracy,
      delta: current.updateIntentAccuracy - baseline.updateIntentAccuracy,
    });
  }
  return regressions;
}
