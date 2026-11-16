import type { EmbeddingRuntimeStatus } from '@memora/shared';
import { MemoryDatabase, type SourceRow, type ChunkRow } from './database.js';
import type { EmbeddingService } from './embeddings.js';
export { TransformersEmbeddingService, DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_DIMENSIONS } from './embeddings.js';
export type { EmbeddingService, EmbeddingModelInfo } from './embeddings.js';
import { scanMarkdown, hashContent } from './scanner.js';
import { chunkMarkdown } from './chunker.js';
import {
  parseMemoryMetadata,
  stripMemoryMetadataComments,
  stripSupersededMemoryLines,
  type MemoryRecord,
} from './memory-metadata.js';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {
  SOURCE_MEMORY_ROOTS,
  validateMemoryTargetPath,
  writeFileAtomically,
} from './markdown-writer.js';

export { MemoryWriter } from './writer.js';
export { MemoryCurator, OpenRouterCuratorProvider, OpenCodeGoCuratorProvider } from './curator.js';
export { MemoryConsolidator } from './consolidator.js';
export type { ConsolidationDecision, ConsolidationKind, ConsolidationRecord, ConsolidationReport, MemoryConsolidatorOptions } from './consolidator.js';
export type { MemoryCuratorProvider, CuratorInput, CuratedMemory, CuratorEvent, CuratorDiagnostic } from './curator.js';
export { MemoryWriterError, matchingMemoryBulletLines, replaceMemoryBullet, validateMemoryTargetPath, writeMemoryMarkdown } from './markdown-writer.js';
export { redactPersonalData, containsPersonalData, containsPersonalDataPlaceholder, PERSONAL_DATA_PLACEHOLDERS } from './privacy.js';
export {
  annotateMemoryBullet,
  deriveLegacyMemoryRecord,
  extractMemoryMetadata,
  formatMemoryMetadata,
  isSupersededLine,
  parseMemoryMetadata,
  stripMemoryMetadataComment,
  stripMemoryMetadataComments,
  stripSupersededMemoryLines,
  validateMemoryRecord,
  validateMemoryRecordReferences,
} from './memory-metadata.js';
export type {
  MemoryEntity,
  MemoryMetadataError,
  MemoryRecord,
  MemoryRecordStatus,
  ParsedMemoryRecord,
} from './memory-metadata.js';
export {
  CURATOR_CLASSES,
  aggregateRetrievalMetrics,
  compareCuratorBaseline,
  compareRetrievalBaseline,
  computeCuratorMetrics,
  computeRetrievalMetrics,
  evaluateCuratorCases,
  evaluateRetrievalMode,
  matchesRetrievalEvidence,
} from './evaluation.js';
export type {
  CuratorCaseResult,
  CuratorClass,
  CuratorClassMetric,
  CuratorEvaluationCase,
  CuratorEvaluationMemory,
  CuratorEvaluationMetrics,
  MetricRegression,
  RetrievalAggregate,
  RetrievalDataset,
  RetrievalDocument,
  RetrievalEvidence,
  RetrievalMetricSet,
  RetrievalMode,
  RetrievalModeResult,
  RetrievalQuery,
  RetrievalQueryMetrics,
  RetrievalSearcher,
  RetrievalSearchResult,
} from './evaluation.js';
export type { PersonalDataKind, PersonalDataRedaction } from './privacy.js';
export type { MemoryWriterConfig, CandidateUpdate } from './writer.js';

export interface MemorySource {
  id: string;
  path: string;
  relativePath: string;
  category: string;
  projectId?: string;
  modifiedAt: number;
  size: number;
  contentHash: string;
  indexedAt: number;
  chunkCount: number;
  title: string | null;
  content?: string;
}

export class MemorySourceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MemorySourceError';
  }
}

export interface MemoryHistoryResult extends MemoryRecord {
  text: string;
  relativePath: string;
  line: number;
}

export interface MemorySearchResult {
  chunkId: string;
  retrievalMode: 'lexical' | 'semantic' | 'hybrid';
  lexicalRank?: number;
  semanticRank?: number;
  fusedRank?: number;
  sourceId: string;
  relativePath: string;
  category: string;
  heading: string | null;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  projectId?: string;
  /** Metadata delle versioni attive contenute nel chunk, se presenti. */
  memory?: MemoryRecord[];
}

export interface SearchOptions {
  topK?: number;
  maxChars?: number;
  maxTokens?: number;
  category?: string;
  projectId?: string;
  globalOnly?: boolean;
  project?: string;
  memoryType?: string;
  minConfidence?: number;
  diversity?: number;
}

type SearchRow = ChunkRow & { rank: number; relativePath: string; category: string; projectId?: string };
export type MemorySearchMode = 'lexical' | 'semantic' | 'hybrid';

/** Explicit mode wins; the legacy flag applies only when no mode was supplied. */
export function resolveMemorySearchMode(mode: string | undefined, legacyHybrid = false, warn?: (message: string) => void): MemorySearchMode {
  if (mode === undefined) return legacyHybrid ? 'hybrid' : 'lexical';
  if (mode === 'lexical' || mode === 'semantic' || mode === 'hybrid') return mode;
  (warn ?? process.emitWarning)('Invalid MEMORA_MEMORY_SEARCH_MODE; using lexical');
  return 'lexical';
}

export interface MemoryServiceOptions {
  embeddings?: EmbeddingService;
  searchMode?: MemorySearchMode;
  /** Default for chat retrieval; live-updatable from admin settings. */
  topK?: number;
  maxChars?: number;
  maxTokens?: number;
  diversity?: number;
  /** Metriche aggregate senza query o contenuti. */
  onRetrieval?: (metric: { latencyMs: number; resultCount: number; estimatedTokens: number; error?: string }) => void;
  sourceFilter?: (relativePath: string, projectId?: string) => boolean | Promise<boolean>;
  /** @deprecated Use searchMode. */
  hybridSearchEnabled?: boolean;
  warn?: (message: string) => void;
}

const DEFAULT_TOP_K = 5;
const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MAX_TOKENS = 1000;
const DEFAULT_DIVERSITY = 0.15;

/**
 * MemoryService — indicizza e ricerca Markdown nella knowledge base.
 *
 * I Markdown sotto $MEMORA_DATA_DIR/{memory,projects,journal,documents}/
 * sono la fonte autorevole. SQLite/FTS5 è solo un indice ricostruibile.
 * Non vengono creati database separati per le conversazioni.
 */
export class MemoryService {
  private readonly dataDir: string;
  private readonly indexDir: string;
  private readonly dbPath: string;
  private db: MemoryDatabase | null = null;
  private vectorReady = false;
  private semanticHealthy = false;
  private fallbackWarned = false;
  private reindexQueue: Promise<void> = Promise.resolve();
  private searchMode: MemorySearchMode;
  private retrievalDefaults: { topK: number; maxChars: number; maxTokens: number; diversity: number };

  constructor(dataDir: string, private readonly config: MemoryServiceOptions = {}) {
    this.dataDir = dataDir;
    this.searchMode = resolveMemorySearchMode(config.searchMode, config.hybridSearchEnabled, config.warn);
    this.retrievalDefaults = {
      topK: config.topK ?? DEFAULT_TOP_K,
      maxChars: config.maxChars ?? DEFAULT_MAX_CHARS,
      maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      diversity: config.diversity ?? DEFAULT_DIVERSITY,
    };
    this.indexDir = path.join(dataDir, 'index');
    this.dbPath = path.join(this.indexDir, 'memora.sqlite');
  }

  async initialize(): Promise<void> {
    fs.mkdirSync(this.indexDir, { recursive: true });
    if (this.db) return;
    this.db = new MemoryDatabase(this.dbPath);
    if (this.config.embeddings) {
      try {
        await this.config.embeddings.initialize();
        if (!this.config.embeddings.isAvailable()) throw new Error('embedding provider unavailable');
        this.db.initializeVectors(this.config.embeddings.getModelInfo().dimensions);
        this.vectorReady = true;
        this.semanticHealthy = true;
      } catch (error) {
        this.warn(error);
      }
    } else if (this.searchMode !== 'lexical') {
      this.warn(new Error('embeddings disabled or not configured'));
    }
  }

  /** Effective mode at this instant; may change after reindex or inference errors. */
  getActiveSearchMode(): MemorySearchMode {
    return this.searchMode !== 'lexical' && this.vectorReady && this.semanticHealthy && this.config.embeddings?.isAvailable()
      ? this.searchMode : 'lexical';
  }

  getConfiguredSearchMode(): MemorySearchMode {
    return this.searchMode;
  }

  /** Live update; the effective mode still falls back to lexical if embeddings are unavailable. */
  setSearchMode(mode: MemorySearchMode): void {
    if (mode !== 'lexical' && mode !== 'semantic' && mode !== 'hybrid') throw new Error('Invalid memory search mode');
    this.searchMode = mode;
    this.fallbackWarned = false;
  }

  getRetrievalDefaults(): { topK: number; maxChars: number; maxTokens: number; diversity: number } {
    return { ...this.retrievalDefaults };
  }

  setRetrievalDefaults(options: { topK?: number; maxChars?: number; maxTokens?: number; diversity?: number }): void {
    if (options.topK !== undefined) {
      if (!Number.isSafeInteger(options.topK) || options.topK < 1 || options.topK > 50) throw new Error('Invalid topK');
      this.retrievalDefaults.topK = options.topK;
    }
    if (options.maxChars !== undefined) {
      if (!Number.isSafeInteger(options.maxChars) || options.maxChars < 500 || options.maxChars > 50000) throw new Error('Invalid maxChars');
      this.retrievalDefaults.maxChars = options.maxChars;
    }
    if (options.maxTokens !== undefined) {
      if (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 50 || options.maxTokens > 50000) throw new Error('Invalid maxTokens');
      this.retrievalDefaults.maxTokens = options.maxTokens;
    }
    if (options.diversity !== undefined) {
      if (!Number.isFinite(options.diversity) || options.diversity < 0 || options.diversity > 1) throw new Error('Invalid diversity');
      this.retrievalDefaults.diversity = options.diversity;
    }
  }

  getEmbeddingStatus(): EmbeddingRuntimeStatus {
    const provider = this.config.embeddings;
    const info = provider?.getModelInfo();
    return {
      enabled: !!provider,
      available: !!provider?.isAvailable(),
      model: info?.model ?? null,
      loaded: this.vectorReady && !!provider?.isAvailable(),
      dimensions: info?.dimensions ?? null,
    };
  }

  private warn(error: unknown): void {
    this.fallbackWarned = true;
    const message = `Semantic retrieval unavailable; using FTS: ${error instanceof Error ? error.message : String(error)}`;
    if (this.config.warn) this.config.warn(message);
    else process.emitWarning(message);
  }

  async reindex(): Promise<void> {
    const task = this.reindexQueue.then(() => this.performReindex());
    this.reindexQueue = task.catch(() => {});
    return task;
  }

  private async performReindex(): Promise<void> {
    if (!this.db) await this.initialize();

    const scanned = scanMarkdown(this.dataDir);
    const results = [];
    for (const result of scanned) {
      if (result.projectId && this.config.sourceFilter && !(await this.config.sourceFilter(result.relativePath, result.projectId))) continue;
      results.push(result);
    }
    const now = Date.now();

    for (const result of results) {
      const existing = this.db!.getSourceByPath(result.absolutePath);

      const parsedMetadata = parseMemoryMetadata(result.content);
      for (const error of parsedMetadata.errors) {
        this.config.warn?.(`Memory metadata ignored in ${result.relativePath} line ${error.line}: ${error.code}`);
      }
      // Chunking is derived data: even an unchanged file may need its index
      // migrated when the chunking strategy changes. I bullet superseded
      // vengono svuotati, non cancellati, per preservare gli offset di riga.
      const indexedContent = stripMemoryMetadataComments(stripSupersededMemoryLines(result.content));
      const chunks = chunkMarkdown(indexedContent, {
        splitStandaloneBullets: result.category === 'memory' || result.category === 'projects',
      }).map((chunk) => {
        const memory = parsedMetadata.records
          .filter(item => item.record.status === 'active' && item.line >= chunk.startLine && item.line <= chunk.endLine)
          .map(item => item.record);
        return { ...chunk, metadata: memory.length > 0 ? JSON.stringify(memory) : null };
      });
      const indexedRecords = existing ? this.db!.getMemoryRecordsBySource(existing.id) : [];
      const recordsMatch = indexedRecords.length === parsedMetadata.records.length && parsedMetadata.records.every((item, index) => {
        const old = indexedRecords[index];
        return old?.versionId === item.record.versionId && old.status === item.record.status && old.line === item.line && old.text === item.text && old.projectId === (item.record.projectId ?? result.projectId);
      });
      if (existing && recordsMatch && existing.contentHash === result.contentHash && existing.modifiedAt === result.modifiedAt) {
        const indexed = this.db!.getChunksBySource(existing.id);
        if (indexed.length === chunks.length && chunks.every((chunk, index) => {
          const old = indexed[index];
          return old?.chunkIndex === chunk.chunkIndex && old.heading === chunk.heading &&
            old.startLine === chunk.startLine && old.endLine === chunk.endLine &&
            old.content === chunk.content && (old.metadata ?? null) === chunk.metadata;
        })) continue;
      }

      // The source, chunks, FTS and vector invalidations commit atomically.
      this.db!.transaction(() => {
        const sourceId = existing?.id ?? hashContent(result.absolutePath + now.toString());
        this.db!.upsertSource({
          id: sourceId,
          path: result.absolutePath,
          relativePath: result.relativePath,
          category: result.category,
          projectId: result.projectId,
          modifiedAt: existing?.modifiedAt ?? -1,
          size: result.size,
          contentHash: existing?.contentHash ?? '',
          indexedAt: now,
        });

        this.db!.replaceMemoryRecordsForSource(sourceId, parsedMetadata.records.map(item => ({ ...item.record, projectId: item.record.projectId ?? result.projectId, line: item.line, text: item.text })));
        const oldChunks = new Map(this.db!.getChunksBySource(sourceId).map(chunk => [chunk.id, chunk]));
        for (const chunk of chunks) {
          const id = hashContent(sourceId + chunk.chunkIndex.toString());
          const old = oldChunks.get(id);
          oldChunks.delete(id);
          if (old && old.content === chunk.content && old.heading === chunk.heading && old.startLine === chunk.startLine && old.endLine === chunk.endLine && (old.metadata ?? null) === chunk.metadata) continue;
          if (old) this.db!.deleteChunk(id, old.content === chunk.content);
          this.db!.upsertChunk({
            id,
            sourceId,
            chunkIndex: chunk.chunkIndex,
            heading: chunk.heading,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            content: chunk.content,
            metadata: chunk.metadata,
          });
        }
        for (const id of oldChunks.keys()) this.db!.deleteChunk(id);
        this.db!.upsertSource({
          id: sourceId, path: result.absolutePath, relativePath: result.relativePath,
          category: result.category, projectId: result.projectId, modifiedAt: result.modifiedAt, size: result.size,
          contentHash: result.contentHash, indexedAt: now,
        });
      });
    }

    // Rimuovi fonti che non esistono più sul disco
    const indexedSources = this.db!.listSources();
    const currentPaths = new Set(results.map((r) => r.absolutePath));
    for (const src of indexedSources) {
      if (!currentPaths.has(src.path)) {
        this.db!.transaction(() => this.db!.deleteSource(src.id));
      }
    }

    const embeddings = this.config.embeddings;
    if (this.vectorReady && embeddings?.isAvailable()) {
      try {
        const info = embeddings.getModelInfo();
        const pending = this.db!.pendingEmbeddings(info.model, info.dimensions);
        for (let i = 0; i < pending.length; i += 8) {
          const batch = pending.slice(i, i + 8);
          const vectors = await embeddings.embedBatch(batch.map(chunk => chunk.content));
          if (vectors.length !== batch.length || vectors.some(vector => vector.length !== info.dimensions)) throw new Error('Invalid embedding batch');
          for (let j = 0; j < batch.length; j++) this.db!.saveEmbedding(batch[j]!, info.model, vectors[j]!);
        }
        this.semanticHealthy = true;
        this.fallbackWarned = false;
      } catch (error) {
        this.semanticHealthy = false;
        this.warn(error);
      }
    }
  }

  /** Cerca solo nelle versioni storiche superate, per domande sul passato. */
  async searchHistory(query: string, options: { topK?: number; relativePaths?: string[]; fallbackToLatest?: boolean } = {}): Promise<MemoryHistoryResult[]> {
    if (!this.db) await this.initialize();
    const stopwords = new Set([
      'che', 'cosa', 'quale', 'quali', 'come', 'quando', 'dove', 'chi', 'di', 'del', 'dello', 'della',
      'dei', 'degli', 'delle', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'e', 'ed', 'a',
      'ad', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra', 'prima', 'dopo', 'usava', 'usa', 'usato',
      'usare', 'era', 'erano', 'stato', 'stata', 'abbiamo', 'avevamo', 'scelto', 'memoria', 'ricorda',
      'precedente', 'precedentemente', 'storia', 'storico', 'cambiato', 'cambiare',
    ]);
    const terms = (query.toLocaleLowerCase('it-IT').match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter(term => term.length >= 2 && !stopwords.has(term));
    if (terms.length === 0) return [];
    const allowedPaths = new Set(options.relativePaths ?? []);
    const scoped = this.db!.getAllMemoryRecords()
      .filter(record => record.status === 'superseded' && record.text.trim())
      .filter(record => allowedPaths.size === 0 || allowedPaths.has(record.relativePath));
    const scored = scoped
      .map(record => {
        const haystack = `${record.relativePath} ${record.text} ${record.project ?? ''} ${(record.tags ?? []).join(' ')}`.toLocaleLowerCase('it-IT');
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { record, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt);
    if (scored.length === 0 && options.fallbackToLatest) {
      return scoped
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, options.topK ?? 5)
        .map(record => ({ ...record, text: record.text, relativePath: record.relativePath, line: record.line }));
    }
    return scored.slice(0, options.topK ?? 5).map(item => ({
      ...item.record,
      text: item.record.text,
      relativePath: item.record.relativePath,
      line: item.record.line,
    }));
  }

  /** Tutte le versioni attive correnti, per audit e consolidamento. */
  async listActiveMemoryRecords(): Promise<MemoryHistoryResult[]> {
    if (!this.db) await this.initialize();
    return this.db!.getAllMemoryRecords()
      .filter(record => record.status === 'active')
      .map(record => ({ ...record, text: record.text, relativePath: record.relativePath, line: record.line }));
  }

  /** Tutte le versioni di una fonte, incluse quelle superseded. */
  async getSourceHistory(sourceId: string): Promise<MemoryHistoryResult[]> {
    if (!this.db) await this.initialize();
    const source = this.db!.getSourceById(sourceId);
    if (!source) throw new MemorySourceError('source_not_found', `Fonte non trovata: ${sourceId}`);
    return this.db!.getMemoryRecordsBySource(sourceId).map(record => ({
      ...record,
      text: record.text,
      relativePath: source.relativePath,
      line: record.line,
    }));
  }

  async search(query: string, options: SearchOptions = {}): Promise<MemorySearchResult[]> {
    if (!this.db) await this.initialize();
    const started = performance.now();
    const topK = options.topK ?? this.retrievalDefaults.topK;
    const broad: SearchOptions = {
      ...options,
      topK: Math.min(50, Math.max(topK * 3, 10)),
      maxChars: Math.min(50_000, Math.max((options.maxChars ?? this.retrievalDefaults.maxChars) * 2, 1000)),
    };
    let results: MemorySearchResult[];
    let errorCode: string | undefined;
    try {
      const mode = this.getActiveSearchMode();
      results = mode === 'semantic'
        ? await this.searchSemantic(query, broad)
        : mode === 'hybrid'
          ? await this.searchHybrid(query, broad)
          : await this.searchLexical(query, broad);
      if (mode === 'lexical' && this.searchMode !== 'lexical' && !this.fallbackWarned) this.warn(new Error('embedding provider unavailable'));
    } catch (error) {
      errorCode = 'retrieval_failed';
      this.warn(error);
      results = await this.searchLexical(query, broad);
    }
    const final = this.applyRetrievalPolicy(results, options, topK);
    this.config.onRetrieval?.({
      latencyMs: performance.now() - started,
      resultCount: final.length,
      estimatedTokens: final.reduce((sum, result) => sum + Math.ceil(result.content.length / 4), 0),
      error: errorCode,
    });
    return final;
  }

  /** Cerca nello scope globale e/o del progetto, poi fonde con RRF. */
  async searchScoped(query: string, options: { topK?: number; maxChars?: number; maxTokens?: number; category?: string; projectId?: string; includeGlobal?: boolean; includeProjectMemory?: boolean; includeProjectSources?: boolean; memoryType?: string; minConfidence?: number; diversity?: number } = {}): Promise<MemorySearchResult[]> {
    const projectId = options.projectId?.trim();
    if (!projectId) return this.search(query, options);
    const topK = options.topK ?? this.retrievalDefaults.topK;
    const projectResults = (await this.search(query, { ...options, projectId, topK: Math.min(50, Math.max(topK * 2, 10)) }))
      .filter((result) => {
        const normalized = result.relativePath.replaceAll('\\', '/').toLocaleLowerCase('it-IT');
        const prefix = `projects/${projectId.toLocaleLowerCase('it-IT')}/`;
        if (!normalized.startsWith(prefix)) return true;
        if (options.includeProjectMemory === false && normalized === `${prefix}memory.md`) return false;
        if (options.includeProjectSources === false && normalized.startsWith(`${prefix}sources/`)) return false;
        return true;
      });
    if (options.includeGlobal === false) return projectResults.slice(0, topK);
    const globalResults = await this.search(query, { ...options, projectId: undefined, globalOnly: true, topK: Math.min(50, Math.max(topK * 2, 10)) });
    const fused = new Map<string, { result: MemorySearchResult; score: number }>();
    for (const list of [projectResults, globalResults]) {
      list.forEach((result, index) => {
        const item = fused.get(result.chunkId) ?? { result, score: 0 };
        item.score += 1 / (60 + index + 1);
        fused.set(result.chunkId, item);
      });
    }
    const ordered = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, topK);
    const maxTokens = options.maxTokens ?? this.retrievalDefaults.maxTokens;
    const maxChars = options.maxChars ?? this.retrievalDefaults.maxChars;
    let tokens = 0;
    let chars = 0;
    const final: MemorySearchResult[] = [];
    for (const item of ordered) {
      const nextTokens = Math.ceil(item.result.content.length / 4);
      if (final.length > 0 && (tokens + nextTokens > maxTokens || chars + item.result.content.length > maxChars)) break;
      final.push({ ...item.result, score: item.score });
      tokens += nextTokens;
      chars += item.result.content.length;
    }
    return final;
  }

  private applyRetrievalPolicy(results: MemorySearchResult[], options: SearchOptions, topK: number): MemorySearchResult[] {
    const project = options.project?.trim().toLocaleLowerCase('it-IT');
    const projectId = options.projectId?.trim().toLocaleLowerCase('it-IT');
    const memoryType = options.memoryType?.trim().toLocaleLowerCase('it-IT');
    const minConfidence = options.minConfidence;
    const filtered = results.filter((result) => {
      const records = result.memory ?? [];
      if (projectId) {
        const pathMatches = result.relativePath.toLocaleLowerCase('it-IT').startsWith(`projects/${projectId}/`);
        const metadataMatches = records.some(record => record.projectId?.toLocaleLowerCase('it-IT') === projectId || result.projectId?.toLocaleLowerCase('it-IT') === projectId);
        if (!pathMatches && !metadataMatches) return false;
      }
      if (options.globalOnly && result.relativePath.toLocaleLowerCase('it-IT').startsWith('projects/')) return false;
      if (project) {
        const matchesProject = records.some(record => record.project?.toLocaleLowerCase('it-IT') === project);
        const slug = project.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (!matchesProject && !result.relativePath.toLocaleLowerCase('it-IT').startsWith(`projects/${slug}/`)) return false;
      }
      if (memoryType && !records.some(record => (record.tags ?? []).some(tag => tag.toLocaleLowerCase('it-IT') === memoryType))) return false;
      if (minConfidence !== undefined && records.length > 0 && !records.some(record => (record.confidence ?? 0) >= minConfidence)) return false;
      return true;
    });

    const ranked = filtered.map((result, index) => {
      const records = result.memory ?? [];
      const confidence = records.length > 0 ? Math.max(...records.map(record => record.confidence ?? 0.5)) : 0.5;
      const importance = records.length > 0
        ? Math.max(...records.map(record => record.importance ?? record.salience ?? 0.5))
        : 0.5;
      const updatedAt = records.length > 0 ? Math.max(...records.map(record => record.updatedAt)) : 0;
      const ageDays = updatedAt > 0 ? Math.max(0, (Date.now() - updatedAt) / 86_400_000) : 0;
      const recency = updatedAt > 0 ? 1 / (1 + ageDays / 30) : 0;
      return {
        result,
        score: 1 / (index + 1) + confidence * 0.01 + importance * 0.008 + recency * 0.005,
      };
    }).sort((a, b) => b.score - a.score);

    const diversity = options.diversity ?? this.retrievalDefaults.diversity;
    const selected: typeof ranked = [];
    const remaining = [...ranked];
    const tokenSets = new Map<string, Set<string>>();
    const tokensFor = (result: MemorySearchResult) => {
      const existing = tokenSets.get(result.chunkId);
      if (existing) return existing;
      const tokens = new Set((result.content.toLocaleLowerCase('it-IT').match(/[\p{L}\p{N}]+/gu) ?? []).filter(token => token.length >= 3));
      tokenSets.set(result.chunkId, tokens);
      return tokens;
    };
    while (remaining.length > 0 && selected.length < topK) {
      let bestIndex = 0;
      let bestValue = Number.NEGATIVE_INFINITY;
      remaining.forEach((candidate, index) => {
        const candidateTokens = tokensFor(candidate.result);
        let similarity = 0;
        if (diversity > 0 && selected.length > 0) {
          similarity = Math.max(...selected.map(item => {
            const other = tokensFor(item.result);
            let shared = 0;
            for (const token of candidateTokens) if (other.has(token)) shared++;
            const union = candidateTokens.size + other.size - shared;
            return union === 0 ? 0 : shared / union;
          }));
        }
        const value = candidate.score - diversity * similarity;
        if (value > bestValue) { bestValue = value; bestIndex = index; }
      });
      selected.push(remaining.splice(bestIndex, 1)[0]!);
    }

    const maxTokens = options.maxTokens ?? this.retrievalDefaults.maxTokens;
    const maxChars = options.maxChars ?? this.retrievalDefaults.maxChars;
    const final: MemorySearchResult[] = [];
    let usedTokens = 0;
    let usedChars = 0;
    for (const item of selected) {
      const tokens = Math.ceil(item.result.content.length / 4);
      if (final.length > 0 && (usedTokens + tokens > maxTokens || usedChars + item.result.content.length > maxChars)) break;
      final.push(item.result);
      usedTokens += tokens;
      usedChars += item.result.content.length;
    }
    return final;
  }

  async searchLexical(query: string, options: SearchOptions = {}): Promise<MemorySearchResult[]> {
    if (!this.db) await this.initialize();

    const topK = options.topK ?? this.retrievalDefaults.topK;
    const maxChars = options.maxChars ?? this.retrievalDefaults.maxChars;
    const category = options.category;

    const rows = this.db!.search(query, topK, maxChars, category);

    return rows.map((row, i) => this.toResult(row, 'lexical', { lexicalRank: i + 1 }));
  }

  private toResult(row: SearchRow, retrievalMode: MemorySearchResult['retrievalMode'], ranks: Partial<MemorySearchResult> = {}): MemorySearchResult {
    let memory: MemoryRecord[] | undefined;
    if (row.metadata) {
      try {
        const parsed = JSON.parse(row.metadata) as unknown;
        if (Array.isArray(parsed)) memory = parsed as MemoryRecord[];
      } catch {
        // Un metadata derivato corrotto non deve rompere la ricerca.
      }
    }
    return {
      chunkId: row.id,
      retrievalMode,
      ...ranks,
      sourceId: row.sourceId,
      relativePath: row.relativePath,
      category: row.category,
      projectId: row.projectId,
      heading: row.heading,
      startLine: row.startLine,
      endLine: row.endLine,
      content: row.content,
      score: row.rank,
      memory,
    };
  }

  async searchSemantic(query: string, options: SearchOptions = {}): Promise<MemorySearchResult[]> {
    if (!this.db) await this.initialize();
    const provider = this.config.embeddings;
    if (!this.vectorReady || !this.semanticHealthy || !provider?.isAvailable()) return [];
    const vector = await provider.embed(query);
    if (vector.length !== provider.getModelInfo().dimensions) throw new Error('Invalid query embedding dimensions');
    const rows = this.db!.searchVectors(vector, provider.getModelInfo().model, options.category);
    let chars = 0;
    const results: MemorySearchResult[] = [];
    for (const row of rows) {
      if (results.length >= (options.topK ?? this.retrievalDefaults.topK)) break;
      if (chars + row.content.length > (options.maxChars ?? this.retrievalDefaults.maxChars)) break;
      chars += row.content.length;
      results.push(this.toResult(row, 'semantic', { semanticRank: results.length + 1 }));
    }
    return results;
  }

  async searchHybrid(query: string, options: SearchOptions = {}): Promise<MemorySearchResult[]> {
    const candidates = Math.max(10, (options.topK ?? this.retrievalDefaults.topK) * 2);
    const broad = { ...options, topK: candidates, maxChars: Number.MAX_SAFE_INTEGER };
    const [lexical, semantic] = await Promise.all([this.searchLexical(query, broad), this.searchSemantic(query, broad)]);
    // RRF k=60: combines ranks, not incomparable BM25/cosine scores.
    const fused = new Map<string, { result: MemorySearchResult; score: number }>();
    for (const [mode, list] of [['lexical', lexical], ['semantic', semantic]] as const) {
      list.forEach((result, i) => {
        const item = fused.get(result.chunkId) ?? { result: { ...result, retrievalMode: 'hybrid' as const }, score: 0 };
        item.score += 1 / (60 + i + 1);
        if (mode === 'lexical') item.result.lexicalRank = i + 1;
        else item.result.semanticRank = i + 1;
        fused.set(result.chunkId, item);
      });
    }
    const sorted = [...fused.values()].sort((a, b) => b.score - a.score || (a.result.lexicalRank ?? Infinity) - (b.result.lexicalRank ?? Infinity) || a.result.chunkId.localeCompare(b.result.chunkId));
    let chars = 0;
    const results: MemorySearchResult[] = [];
    for (const item of sorted) {
      if (results.length >= (options.topK ?? this.retrievalDefaults.topK)) break;
      if (chars + item.result.content.length > (options.maxChars ?? this.retrievalDefaults.maxChars)) break;
      chars += item.result.content.length;
      results.push({ ...item.result, score: item.score, fusedRank: results.length + 1 });
    }
    return results;
  }

  private toMemorySource(row: SourceRow): MemorySource {
    return {
      id: row.id,
      path: row.path,
      relativePath: row.relativePath,
      category: row.category,
      projectId: row.projectId,
      modifiedAt: row.modifiedAt,
      size: row.size,
      contentHash: row.contentHash,
      indexedAt: row.indexedAt,
      chunkCount: row.chunkCount ?? 0,
      title: row.title ?? null,
    };
  }

  private async resolveSourceTarget(row: SourceRow): Promise<{ absolutePath: string; relativePath: string; mode: number }> {
    const dataRoot = path.resolve(this.dataDir);
    const relative = path.relative(dataRoot, path.resolve(row.path));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new MemorySourceError('source_forbidden', 'La fonte non appartiene a MEMORA_DATA_DIR');
    }

    let target;
    try {
      const normalized = relative.replaceAll('\\', '/');
      const isProjectSourceText = /^projects\/[^/]+\/sources\/.+\.txt$/.test(normalized);
      target = await validateMemoryTargetPath(this.dataDir, relative, {
        allowedRoots: SOURCE_MEMORY_ROOTS,
        extensions: isProjectSourceText ? ['.md', '.txt'] : ['.md'],
      });
    } catch {
      throw new MemorySourceError('source_forbidden', 'La fonte non è in una directory testuale consentita');
    }

    let stat;
    try {
      stat = await fsp.lstat(target.absolutePath);
    } catch {
      throw new MemorySourceError('source_not_found', `File della fonte non trovato: ${row.relativePath}`);
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new MemorySourceError('source_forbidden', 'La fonte non può essere un symlink o una directory');
    }

    const mode = (stat.mode & 0o022) === 0 ? (stat.mode & 0o777) : 0o600;
    return { ...target, mode };
  }

  async listSources(): Promise<MemorySource[]> {
    if (!this.db) await this.initialize();

    return this.db!.listSources().map((row) => this.toMemorySource(row));
  }

  async integrityCheck(): Promise<{ ok: boolean; messages: string[]; foreignKeyViolations: number; sources: number; chunks: number; records: number; embeddings: number }> {
    if (!this.db) await this.initialize();
    const integrity = this.db!.integrityCheck();
    const foreignKeyViolations = this.db!.foreignKeyCheck().length;
    return { ...integrity, ok: integrity.ok && foreignKeyViolations === 0, foreignKeyViolations };
  }

  async getSource(sourceId: string): Promise<MemorySource | null> {
    if (!this.db) await this.initialize();

    const row = this.db!.getSourceById(sourceId);
    return row ? this.toMemorySource(row) : null;
  }

  /** Recupera una fonte per ID, con contenuto Markdown completo. */
  async getSourceContent(sourceId: string): Promise<MemorySource & { content: string }> {
    if (!this.db) await this.initialize();

    const row = this.db!.getSourceById(sourceId);
    if (!row) {
      throw new MemorySourceError('source_not_found', `Fonte non trovata: ${sourceId}`);
    }
    const target = await this.resolveSourceTarget(row);
    const content = await fsp.readFile(target.absolutePath, 'utf-8');
    return { ...this.toMemorySource(row), content };
  }

  /** Crea una nuova fonte Markdown e la indicizza. */
  async createSource(relativePath: string, content: string): Promise<MemorySource & { content: string }> {
    if (!this.db) await this.initialize();
    if (typeof content !== 'string') throw new MemorySourceError('invalid_source_content', 'Il contenuto deve essere una stringa');
    const target = await validateMemoryTargetPath(this.dataDir, relativePath, { allowedRoots: ['projects'], extensions: ['.md', '.txt'] });
    const existing = this.db!.listSources().find(source => source.relativePath === target.relativePath);
    if (existing) throw new MemorySourceError('source_already_exists', 'La fonte esiste già');
    await fsp.mkdir(path.dirname(target.absolutePath), { recursive: true, mode: 0o700 });
    await writeFileAtomically(target.absolutePath, content, 0o600);
    await this.reindex();
    const source = (await this.listSources()).find(item => item.relativePath === target.relativePath);
    if (!source) throw new MemorySourceError('source_not_found', 'Fonte creata ma non indicizzata');
    return { ...source, content };
  }

  /** Modifica atomicamente il contenuto della fonte e reindicizza. */
  async updateSourceContent(sourceId: string, content: string): Promise<MemorySource & { content: string }> {
    if (!this.db) await this.initialize();
    if (typeof content !== 'string') {
      throw new MemorySourceError('invalid_source_content', 'Il contenuto deve essere una stringa');
    }

    const row = this.db!.getSourceById(sourceId);
    if (!row) {
      throw new MemorySourceError('source_not_found', `Fonte non trovata: ${sourceId}`);
    }
    const target = await this.resolveSourceTarget(row);
    await writeFileAtomically(target.absolutePath, content, target.mode);
    await this.reindex();
    return this.getSourceContent(sourceId);
  }

  /** Elimina solo il file Markdown della fonte e reindicizza. */
  async deleteSource(sourceId: string): Promise<{ sourceId: string; relativePath: string }> {
    if (!this.db) await this.initialize();

    const row = this.db!.getSourceById(sourceId);
    if (!row) {
      throw new MemorySourceError('source_not_found', `Fonte non trovata: ${sourceId}`);
    }
    const target = await this.resolveSourceTarget(row);
    try {
      await fsp.unlink(target.absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new MemorySourceError('source_not_found', `File della fonte non trovato: ${row.relativePath}`);
      }
      throw error;
    }
    await this.reindex();
    return { sourceId, relativePath: target.relativePath };
  }

  async close(): Promise<void> {
    await this.reindexQueue;
    this.vectorReady = false;
    this.semanticHealthy = false;
    await this.config.embeddings?.close();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  getStats(): { sourceCount: number; chunkCount: number; vectorCount: number } {
    if (!this.db) return { sourceCount: 0, chunkCount: 0, vectorCount: 0 };
    return {
      sourceCount: this.db.getSourceCount(),
      chunkCount: this.db.getChunkCount(),
      vectorCount: this.db.getEmbeddingCount(),
    };
  }
}
