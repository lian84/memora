import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import * as sqliteVec from 'sqlite-vec';
import { hashContent } from './scanner.js';
import type { MemoryRecord } from './memory-metadata.js';

/** Schema SQLite per l'indice Second Brain. */
const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS memory_sources (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  relativePath TEXT NOT NULL,
  category TEXT NOT NULL,
  projectId TEXT,
  modifiedAt INTEGER NOT NULL,
  size INTEGER NOT NULL,
  contentHash TEXT NOT NULL,
  indexedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_chunks (
  id TEXT PRIMARY KEY,
  sourceId TEXT NOT NULL,
  chunkIndex INTEGER NOT NULL,
  heading TEXT,
  startLine INTEGER NOT NULL,
  endLine INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  FOREIGN KEY (sourceId) REFERENCES memory_sources(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
  content,
  content=''
);

CREATE TABLE IF NOT EXISTS memory_records (
  versionId TEXT PRIMARY KEY,
  memoryId TEXT NOT NULL,
  sourceId TEXT NOT NULL,
  line INTEGER NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  projectId TEXT,
  sourceSessionId TEXT,
  sourceMessageId TEXT,
  sourceTurnId TEXT,
  sourceTimestamp INTEGER,
  confidence REAL,
  importance REAL,
  durability REAL,
  futureUtility REAL,
  novelty REAL,
  salience REAL,
  scope TEXT,
  project TEXT,
  entities TEXT,
  tags TEXT,
  curatorProvider TEXT,
  curatorModel TEXT,
  supersedes TEXT,
  supersededBy TEXT,
  FOREIGN KEY (sourceId) REFERENCES memory_sources(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memory_records_memory_id ON memory_records(memoryId);
`;

export interface SourceRow {
  id: string;
  path: string;
  relativePath: string;
  category: string;
  projectId?: string;
  modifiedAt: number;
  size: number;
  contentHash: string;
  indexedAt: number;
  chunkCount?: number;
  title?: string | null;
}

export interface ChunkRow {
  id: string;
  sourceId: string;
  chunkIndex: number;
  heading: string | null;
  startLine: number;
  endLine: number;
  content: string;
  metadata?: string | null;
}

export class MemoryDatabase {
  private db: Database.Database;
  private vectorsReady = false;

  constructor(dbPath: string) {
    // Crea la directory se non esiste
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);
    this.ensureColumn('memory_sources', 'projectId', 'TEXT');
    this.ensureColumn('memory_chunks', 'metadata', 'TEXT');
    this.ensureColumn('memory_records', 'content', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('memory_records', 'projectId', 'TEXT');
    this.ensureColumn('memory_records', 'importance', 'REAL');
    this.ensureColumn('memory_records', 'durability', 'REAL');
    this.ensureColumn('memory_records', 'futureUtility', 'REAL');
    this.ensureColumn('memory_records', 'novelty', 'REAL');
    this.ensureColumn('memory_records', 'salience', 'REAL');
    this.ensureFtsIntegrity();
  }

  private ensureFtsIntegrity(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version >= 2) return;
    // FTS contentless non supporta REPLACE affidabile: ricostruisci una volta
    // l'indice derivato dai chunk correnti e marca lo schema come migrato.
    this.db.exec(`
      DROP TABLE IF EXISTS memory_chunks_fts;
      CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(content, content='');
      INSERT INTO memory_chunks_fts(rowid, content) SELECT rowid, content FROM memory_chunks;
      PRAGMA user_version = 2;
    `);
  }

  private ensureColumn(table: string, column: string, type: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some(item => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  upsertSource(source: SourceRow): void {
    this.db.prepare(`
      INSERT INTO memory_sources (id, path, relativePath, category, projectId, modifiedAt, size, contentHash, indexedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET path=excluded.path, relativePath=excluded.relativePath,
        category=excluded.category, projectId=excluded.projectId, modifiedAt=excluded.modifiedAt, size=excluded.size,
        contentHash=excluded.contentHash, indexedAt=excluded.indexedAt
    `).run(
      source.id,
      source.path,
      source.relativePath,
      source.category,
      source.projectId ?? null,
      source.modifiedAt,
      source.size,
      source.contentHash,
      source.indexedAt
    );
  }

  deleteSource(sourceId: string): void {
    this.deleteChunksForSource(sourceId);
    this.db.prepare('DELETE FROM memory_records WHERE sourceId = ?').run(sourceId);
    this.db.prepare('DELETE FROM memory_sources WHERE id = ?').run(sourceId);
  }

  upsertChunk(chunk: ChunkRow): void {
    const existing = this.db.prepare('SELECT rowid, content FROM memory_chunks WHERE id = ?').get(chunk.id) as { rowid: number; content: string } | undefined;
    if (existing) {
      this.db.prepare("INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, content) VALUES ('delete', ?, ?)").run(existing.rowid, existing.content);
      this.db.prepare(`
        UPDATE memory_chunks SET sourceId=?, chunkIndex=?, heading=?, startLine=?, endLine=?, content=?, metadata=?
        WHERE id=?
      `).run(
        chunk.sourceId, chunk.chunkIndex, chunk.heading ?? null, chunk.startLine,
        chunk.endLine, chunk.content, chunk.metadata ?? null, chunk.id,
      );
      this.db.prepare('INSERT INTO memory_chunks_fts (rowid, content) VALUES (?, ?)').run(existing.rowid, chunk.content);
      return;
    }

    const result = this.db.prepare(`
      INSERT INTO memory_chunks (id, sourceId, chunkIndex, heading, startLine, endLine, content, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chunk.id, chunk.sourceId, chunk.chunkIndex, chunk.heading ?? null,
      chunk.startLine, chunk.endLine, chunk.content, chunk.metadata ?? null,
    );
    this.db.prepare('INSERT INTO memory_chunks_fts (rowid, content) VALUES (?, ?)').run(result.lastInsertRowid, chunk.content);
  }

  deleteChunk(id: string, preserveVector = false): void {
    const row = this.db.prepare('SELECT rowid, content FROM memory_chunks WHERE id = ?').get(id) as { rowid: number; content: string } | undefined;
    if (!row) return;
    this.db.prepare("INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, content) VALUES ('delete', ?, ?)").run(row.rowid, row.content);
    // Vector tables might not have been initialized in this process. They are
    // cleaned on the next vector initialization as well.
    if (this.vectorsReady && !preserveVector) this.deleteVector(id);
    this.db.prepare('DELETE FROM memory_chunks WHERE id = ?').run(id);
  }

  deleteChunksForSource(sourceId: string): void {
    for (const chunk of this.getChunksBySource(sourceId)) this.deleteChunk(chunk.id);
  }

  initializeVectors(dimensions: number): void {
    if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 65536) throw new Error('Invalid embedding dimensions');
    sqliteVec.load(this.db);
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_embeddings (
      id INTEGER PRIMARY KEY, chunkId TEXT NOT NULL UNIQUE,
      contentHash TEXT NOT NULL, embeddingModel TEXT NOT NULL, dimensions INTEGER NOT NULL
    )`);
    this.db.exec('CREATE TABLE IF NOT EXISTS memory_vector_config (id INTEGER PRIMARY KEY CHECK (id=1), dimensions INTEGER NOT NULL)');
    const existing = this.db.prepare('SELECT dimensions FROM memory_vector_config WHERE id=1').get() as { dimensions: number } | undefined;
    if (existing && existing.dimensions !== dimensions) {
      this.db.exec('DROP TABLE IF EXISTS memory_vectors; DELETE FROM memory_embeddings');
    }
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(embedding float[${dimensions}] distance_metric=cosine)`);
    this.db.prepare('INSERT OR REPLACE INTO memory_vector_config (id, dimensions) VALUES (1, ?)').run(dimensions);
    this.vectorsReady = true;
    const entries = this.db.prepare('SELECT e.chunkId, e.contentHash, c.content FROM memory_embeddings e LEFT JOIN memory_chunks c ON c.id=e.chunkId').all() as { chunkId: string; contentHash: string; content: string | null }[];
    for (const row of entries) if (row.content === null || row.contentHash !== hashContent(row.content)) this.deleteVector(row.chunkId);
  }

  deleteVector(chunkId: string): void {
    const row = this.db.prepare('SELECT id FROM memory_embeddings WHERE chunkId = ?').get(chunkId) as { id: number } | undefined;
    if (row) {
      this.db.prepare('DELETE FROM memory_vectors WHERE rowid = ?').run(row.id);
      this.db.prepare('DELETE FROM memory_embeddings WHERE id = ?').run(row.id);
    }
  }

  pendingEmbeddings(model: string, dimensions: number): ChunkRow[] {
    const rows = this.db.prepare(`SELECT c.*, e.contentHash AS embeddingHash, e.embeddingModel, e.dimensions
      FROM memory_chunks c LEFT JOIN memory_embeddings e ON e.chunkId=c.id`).all() as Array<ChunkRow & { embeddingHash: string | null; embeddingModel: string | null; dimensions: number | null }>;
    return rows.filter(row => row.embeddingModel !== model || row.dimensions !== dimensions || row.embeddingHash !== hashContent(row.content));
  }

  saveEmbedding(chunk: ChunkRow, model: string, vector: Float32Array): void {
    this.db.transaction(() => {
      this.deleteVector(chunk.id);
      const result = this.db.prepare('INSERT INTO memory_embeddings (chunkId, contentHash, embeddingModel, dimensions) VALUES (?, ?, ?, ?)')
        .run(chunk.id, hashContent(chunk.content), model, vector.length);
      this.db.prepare('INSERT INTO memory_vectors (rowid, embedding) VALUES (?, ?)').run(BigInt(result.lastInsertRowid), Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
    })();
  }

  searchVectors(vector: Float32Array, model: string, category?: string): Array<ChunkRow & { rank: number; relativePath: string; category: string }> {
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM memory_embeddings').get() as { n: number }).n;
    if (!count) return [];
    // KNN first, then filter metadata; overfetch ensures category/model filtering is correct.
    return this.db.prepare(`SELECT c.*, s.relativePath, s.category, s.projectId, v.distance AS rank
      FROM (SELECT rowid, distance FROM memory_vectors WHERE embedding MATCH ? AND k = ?) v
      JOIN memory_embeddings e ON e.id=v.rowid
      JOIN memory_chunks c ON c.id=e.chunkId JOIN memory_sources s ON s.id=c.sourceId
      WHERE e.embeddingModel = ? AND (? IS NULL OR s.category = ?) ORDER BY v.distance, c.id`)
      .all(Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength), count, model, category ?? null, category ?? null) as Array<ChunkRow & { rank: number; relativePath: string; category: string; projectId?: string }>;
  }

  getSourceByPath(path: string): SourceRow | undefined {
    return this.db.prepare('SELECT * FROM memory_sources WHERE path = ?').get(path) as SourceRow | undefined;
  }

  getSourceById(id: string): SourceRow | undefined {
    return this.db.prepare(`
      SELECT s.*,
             (SELECT COUNT(*) FROM memory_chunks c WHERE c.sourceId = s.id) AS chunkCount,
             (SELECT c.heading FROM memory_chunks c WHERE c.sourceId = s.id AND c.chunkIndex = 0 LIMIT 1) AS title
      FROM memory_sources s
      WHERE s.id = ?
    `).get(id) as SourceRow | undefined;
  }

  getChunksBySource(sourceId: string): ChunkRow[] {
    return this.db.prepare('SELECT * FROM memory_chunks WHERE sourceId = ? ORDER BY chunkIndex').all(sourceId) as ChunkRow[];
  }

  listSources(): SourceRow[] {
    return this.db.prepare(`
      SELECT s.*,
             (SELECT COUNT(*) FROM memory_chunks c WHERE c.sourceId = s.id) AS chunkCount,
             (SELECT c.heading FROM memory_chunks c WHERE c.sourceId = s.id AND c.chunkIndex = 0 LIMIT 1) AS title
      FROM memory_sources s
      ORDER BY s.modifiedAt DESC
    `).all() as SourceRow[];
  }

  search(query: string, topK: number, maxChars: number, category?: string): Array<ChunkRow & { rank: number; relativePath: string; category: string }> {
    // Estrae token Unicode e ignora la punteggiatura del prompt utente
    // (per esempio "Aurora?"). I termini sono collegati con OR: una domanda
    // naturale contiene spesso parole interrogative o stopword assenti dal
    // chunk, quindi un AND su tutti i token produrrebbe falsi zero risultati.
    const terms = query.match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [];
    const quotedQuery = terms
      .map((term) => `"${term.replace(/"/g, '""')}"`)
      .join(' OR ');
    const where = category ? 'AND s.category = ?' : '';
    if (!quotedQuery) return [];
    const params: unknown[] = [quotedQuery];
    if (category) params.push(category);
    params.push(topK);

    const rows = this.db.prepare(`
      SELECT c.id, c.sourceId, c.chunkIndex, c.heading, c.startLine, c.endLine, c.content, c.metadata,
             bm25(memory_chunks_fts) as rank,
             s.relativePath, s.category, s.projectId
      FROM memory_chunks_fts f
      JOIN memory_chunks c ON c.rowid = f.rowid
      JOIN memory_sources s ON s.id = c.sourceId
      WHERE memory_chunks_fts MATCH ? ${where}
      ORDER BY rank
      LIMIT ?
    `).all(params) as Array<ChunkRow & { rank: number; relativePath: string; category: string; projectId?: string }>;

    // Limita caratteri totali
    let totalChars = 0;
    const limited: Array<ChunkRow & { rank: number; relativePath: string; category: string; projectId?: string }> = [];
    for (const row of rows) {
      if (totalChars + row.content.length > maxChars) break;
      totalChars += row.content.length;
      limited.push({
        id: row.id,
        sourceId: row.sourceId,
        chunkIndex: row.chunkIndex,
        heading: row.heading,
        startLine: row.startLine,
        endLine: row.endLine,
        content: row.content,
        metadata: row.metadata,
        rank: row.rank,
        relativePath: row.relativePath,
        category: row.category,
        projectId: row.projectId,
      });
    }
    return limited;
  }

  replaceMemoryRecordsForSource(sourceId: string, records: Array<MemoryRecord & { line: number; text?: string }>): void {
    this.db.prepare('DELETE FROM memory_records WHERE sourceId = ?').run(sourceId);
    const insert = this.db.prepare(`INSERT INTO memory_records (
      versionId, memoryId, sourceId, line, version, status, createdAt, updatedAt, content, projectId,
      sourceSessionId, sourceMessageId, sourceTurnId, sourceTimestamp, confidence,
      importance, durability, futureUtility, novelty, salience,
      scope, project, entities, tags, curatorProvider, curatorModel, supersedes, supersededBy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const record of records) {
      insert.run(
        record.versionId, record.memoryId, sourceId, record.line, record.version, record.status,
        record.createdAt, record.updatedAt, record.text ?? '', record.projectId ?? null, record.sourceSessionId ?? null, record.sourceMessageId ?? null,
        record.sourceTurnId ?? null, record.sourceTimestamp ?? null, record.confidence ?? null,
        record.importance ?? null, record.durability ?? null, record.futureUtility ?? null,
        record.novelty ?? null, record.salience ?? null,
        record.scope ?? null, record.project ?? null, JSON.stringify(record.entities ?? []),
        JSON.stringify(record.tags ?? []), record.curatorProvider ?? null, record.curatorModel ?? null,
        JSON.stringify(record.supersedes ?? []), record.supersededBy ?? null,
      );
    }
  }

  getMemoryRecordsBySource(sourceId: string): Array<MemoryRecord & { line: number; text: string }> {
    const rows = this.db.prepare('SELECT * FROM memory_records WHERE sourceId = ? ORDER BY line, version').all(sourceId) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      memoryId: row.memoryId as string,
      versionId: row.versionId as string,
      line: row.line as number,
      version: row.version as number,
      status: row.status as MemoryRecord['status'],
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
      text: (row.content as string) ?? '',
      projectId: (row.projectId as string | null) ?? undefined,
      confidence: (row.confidence as number | null) ?? undefined,
      importance: (row.importance as number | null) ?? undefined,
      durability: (row.durability as number | null) ?? undefined,
      futureUtility: (row.futureUtility as number | null) ?? undefined,
      novelty: (row.novelty as number | null) ?? undefined,
      salience: (row.salience as number | null) ?? undefined,
      sourceSessionId: (row.sourceSessionId as string | null) ?? undefined,
      sourceMessageId: (row.sourceMessageId as string | null) ?? undefined,
      sourceTurnId: (row.sourceTurnId as string | null) ?? undefined,
      sourceTimestamp: (row.sourceTimestamp as number | null) ?? undefined,
      scope: (row.scope as string | null) ?? undefined,
      project: (row.project as string | null) ?? undefined,
      entities: JSON.parse((row.entities as string) || '[]') as MemoryRecord['entities'],
      tags: JSON.parse((row.tags as string) || '[]') as string[],
      curatorProvider: (row.curatorProvider as string | null) ?? undefined,
      curatorModel: (row.curatorModel as string | null) ?? undefined,
      supersedes: JSON.parse((row.supersedes as string) || '[]') as string[],
      supersededBy: (row.supersededBy as string | null) ?? null,
    }));
  }

  getAllMemoryRecords(): Array<MemoryRecord & { line: number; text: string; relativePath: string; sourceId: string }> {
    const rows = this.db.prepare(`
      SELECT r.*, s.relativePath
      FROM memory_records r JOIN memory_sources s ON s.id = r.sourceId
      ORDER BY r.updatedAt DESC, r.line
    `).all() as Array<Record<string, unknown>>;
    return rows.map(row => ({
      memoryId: row.memoryId as string,
      versionId: row.versionId as string,
      sourceId: row.sourceId as string,
      relativePath: row.relativePath as string,
      line: row.line as number,
      version: row.version as number,
      status: row.status as MemoryRecord['status'],
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
      text: (row.content as string) ?? '',
      projectId: (row.projectId as string | null) ?? undefined,
      confidence: (row.confidence as number | null) ?? undefined,
      importance: (row.importance as number | null) ?? undefined,
      durability: (row.durability as number | null) ?? undefined,
      futureUtility: (row.futureUtility as number | null) ?? undefined,
      novelty: (row.novelty as number | null) ?? undefined,
      salience: (row.salience as number | null) ?? undefined,
      sourceSessionId: (row.sourceSessionId as string | null) ?? undefined,
      sourceMessageId: (row.sourceMessageId as string | null) ?? undefined,
      sourceTurnId: (row.sourceTurnId as string | null) ?? undefined,
      sourceTimestamp: (row.sourceTimestamp as number | null) ?? undefined,
      scope: (row.scope as string | null) ?? undefined,
      project: (row.project as string | null) ?? undefined,
      entities: JSON.parse((row.entities as string) || '[]') as MemoryRecord['entities'],
      tags: JSON.parse((row.tags as string) || '[]') as string[],
      curatorProvider: (row.curatorProvider as string | null) ?? undefined,
      curatorModel: (row.curatorModel as string | null) ?? undefined,
      supersedes: JSON.parse((row.supersedes as string) || '[]') as string[],
      supersededBy: (row.supersededBy as string | null) ?? null,
    }));
  }

  getSourceCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM memory_sources').get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  getChunkCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM memory_chunks').get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  getEmbeddingCount(): number {
    try {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM memory_embeddings').get() as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    } catch {
      return 0;
    }
  }

  integrityCheck(): { ok: boolean; messages: string[]; sources: number; chunks: number; records: number; embeddings: number } {
    const rows = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const messages = rows.map(row => row.integrity_check).filter(message => message !== 'ok');
    return {
      ok: messages.length === 0,
      messages,
      sources: this.getSourceCount(),
      chunks: this.getChunkCount(),
      records: (this.db.prepare('SELECT COUNT(*) AS n FROM memory_records').get() as { n: number }).n,
      embeddings: this.getEmbeddingCount(),
    };
  }

  foreignKeyCheck(): Array<Record<string, unknown>> {
    return this.db.pragma('foreign_key_check') as Array<Record<string, unknown>>;
  }

  vacuum(): void {
    this.db.pragma('VACUUM');
  }

  close(): void {
    this.db.close();
  }
}
