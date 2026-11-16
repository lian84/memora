import crypto from 'node:crypto';

export type MemoryRecordStatus = 'active' | 'superseded';

export interface MemoryEntity {
  type: string;
  name: string;
}

/**
 * Metadata di una singola versione di memoria, persistita come commento HTML
 * sulla riga del bullet. `memoryId` identifica la lineage stabile; `versionId`
 * identifica lo stato specifico e cambia a ogni aggiornamento.
 */
export interface MemoryRecord {
  memoryId: string;
  versionId: string;
  version: number;
  status: MemoryRecordStatus;
  createdAt: number;
  updatedAt: number;
  sourceSessionId?: string;
  sourceMessageId?: string;
  sourceTurnId?: string;
  sourceTimestamp?: number;
  confidence?: number;
  importance?: number;
  durability?: number;
  futureUtility?: number;
  novelty?: number;
  salience?: number;
  scope?: string;
  project?: string;
  projectId?: string;
  entities?: MemoryEntity[];
  tags?: string[];
  curatorProvider?: string;
  curatorModel?: string;
  supersedes?: string[];
  supersededBy?: string | null;
}

export interface ParsedMemoryRecord {
  record: MemoryRecord;
  line: number;
  /** Testo del bullet senza marker e senza commento metadata. */
  text: string;
}

export interface MemoryMetadataError {
  line: number;
  code: string;
}

const METADATA_PREFIX = 'memora-memory:v1';
const COMMENT_PATTERN = /<!--\s*memora-memory:v1\s+([\s\S]*?)\s*-->/g;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const SAFE_STRING_PATTERN = /^[^\0\r\n]{1,300}$/;
const TAG_PATTERN = /^[^\0\r\n]{1,80}$/;
const STATUSES: readonly string[] = ['active', 'superseded'];

function recordObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalString(value: unknown, pattern = ID_PATTERN): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('invalid_string');
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('invalid_number');
  return value;
}

function stringArray(value: unknown, pattern = ID_PATTERN): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !pattern.test(item))) {
    throw new Error('invalid_string_array');
  }
  return [...value];
}

function entities(value: unknown): MemoryEntity[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('invalid_entities');
  return value.map((item) => {
    const entity = recordObject(item);
    if (!entity || typeof entity.type !== 'string' || typeof entity.name !== 'string') throw new Error('invalid_entity');
    return { type: entity.type.slice(0, 80), name: entity.name.slice(0, 160) };
  });
}

export function validateMemoryRecord(value: unknown): MemoryRecord {
  const raw = recordObject(value);
  if (!raw) throw new Error('invalid_record');
  if (typeof raw.memoryId !== 'string' || !ID_PATTERN.test(raw.memoryId)) throw new Error('invalid_memory_id');
  if (typeof raw.versionId !== 'string' || !ID_PATTERN.test(raw.versionId)) throw new Error('invalid_version_id');
  if (!Number.isSafeInteger(raw.version) || (raw.version as number) < 1) throw new Error('invalid_version');
  if (typeof raw.status !== 'string' || !STATUSES.includes(raw.status)) throw new Error('invalid_status');
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) throw new Error('invalid_created_at');
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) throw new Error('invalid_updated_at');
  const confidence = optionalNumber(raw.confidence);
  if (confidence !== undefined && (confidence < 0 || confidence > 1)) throw new Error('invalid_confidence');
  const score = (value: unknown) => {
    const number = optionalNumber(value);
    if (number !== undefined && (number < 0 || number > 1)) throw new Error('invalid_score');
    return number;
  };
  return {
    memoryId: raw.memoryId,
    versionId: raw.versionId,
    version: raw.version as number,
    status: raw.status as MemoryRecordStatus,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sourceSessionId: optionalString(raw.sourceSessionId, SAFE_STRING_PATTERN),
    sourceMessageId: optionalString(raw.sourceMessageId, SAFE_STRING_PATTERN),
    sourceTurnId: optionalString(raw.sourceTurnId, SAFE_STRING_PATTERN),
    sourceTimestamp: optionalNumber(raw.sourceTimestamp),
    confidence,
    importance: score(raw.importance),
    durability: score(raw.durability),
    futureUtility: score(raw.futureUtility),
    novelty: score(raw.novelty),
    salience: score(raw.salience),
    scope: optionalString(raw.scope, SAFE_STRING_PATTERN),
    project: optionalString(raw.project, /^.{0,160}$/),
    projectId: optionalString(raw.projectId, ID_PATTERN),
    entities: entities(raw.entities),
    tags: stringArray(raw.tags, TAG_PATTERN),
    curatorProvider: optionalString(raw.curatorProvider, SAFE_STRING_PATTERN),
    curatorModel: optionalString(raw.curatorModel, SAFE_STRING_PATTERN),
    supersedes: stringArray(raw.supersedes),
    supersededBy: raw.supersededBy === undefined || raw.supersededBy === null ? null : optionalString(raw.supersededBy) ?? null,
  };
}

/** Estrae tutti i metadata presenti nella riga, ignorando commenti invalidi. */
export function extractMemoryMetadata(line: string): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  for (const match of line.matchAll(COMMENT_PATTERN)) {
    try {
      records.push(validateMemoryRecord(JSON.parse(match[1]!)));
    } catch {
      // Il parser principale riporta l'errore con il numero di riga.
    }
  }
  return records;
}

/** Rimuove i commenti metadata da una riga, lasciando intatto il testo del bullet. */
export function stripMemoryMetadataComment(line: string): string {
  return line.replace(COMMENT_PATTERN, '').replace(/[ \t]+$/, '');
}

/** Rimuove tutti i commenti metadata preservando il numero di righe. */
export function stripMemoryMetadataComments(content: string): string {
  return content.split('\n').map(stripMemoryMetadataComment).join('\n');
}

/** True se la riga contiene solo versioni superseded. */
export function isSupersededLine(line: string): boolean {
  const records = extractMemoryMetadata(line);
  return records.length > 0 && records.every(record => record.status === 'superseded');
}

/** Sostituisce con righe vuote i bullet storici, preservando gli offset di riga. */
export function stripSupersededMemoryLines(content: string): string {
  return content.split('\n').map((line) => isSupersededLine(line) ? '' : line).join('\n');
}

export function parseMemoryMetadata(content: string): { records: ParsedMemoryRecord[]; errors: MemoryMetadataError[] } {
  const records: ParsedMemoryRecord[] = [];
  const errors: MemoryMetadataError[] = [];
  content.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(COMMENT_PATTERN)) {
      let value: unknown;
      try {
        value = JSON.parse(match[1]!);
      } catch {
        errors.push({ line: index + 1, code: 'invalid_json' });
        continue;
      }
      try {
        records.push({
          record: validateMemoryRecord(value),
          line: index + 1,
          text: stripMemoryMetadataComment(line).replace(/^\s*[-*+]\s+/, '').trim(),
        });
      } catch (error) {
        errors.push({ line: index + 1, code: error instanceof Error ? error.message : 'invalid_record' });
      }
    }
  });
  return { records, errors: [...errors, ...validateMemoryRecordReferences(records.map(item => item.record), records.map(item => item.line))] };
}

/** Verifica identità, stato e riferimenti delle versioni nello stesso file. */
export function validateMemoryRecordReferences(records: MemoryRecord[], lines?: number[]): MemoryMetadataError[] {
  const errors: MemoryMetadataError[] = [];
  const lineFor = (index: number) => lines?.[index] ?? index + 1;
  const byVersion = new Map<string, { record: MemoryRecord; index: number }>();
  records.forEach((record, index) => {
    if (byVersion.has(record.versionId)) {
      errors.push({ line: lineFor(index), code: 'duplicate_version_id' });
    } else {
      byVersion.set(record.versionId, { record, index });
    }
  });
  records.forEach((record, index) => {
    if (record.status === 'active' && record.supersededBy) {
      errors.push({ line: lineFor(index), code: 'active_has_superseded_by' });
    }
    if (record.status === 'superseded' && !record.supersededBy) {
      errors.push({ line: lineFor(index), code: 'superseded_without_superseded_by' });
    }
    for (const versionId of record.supersedes ?? []) {
      const target = byVersion.get(versionId);
      if (!target) errors.push({ line: lineFor(index), code: 'missing_supersedes_target' });
      else if (target.record.memoryId !== record.memoryId) errors.push({ line: lineFor(index), code: 'supersedes_memory_mismatch' });
    }
    if (record.supersededBy) {
      const target = byVersion.get(record.supersededBy);
      if (!target) errors.push({ line: lineFor(index), code: 'missing_superseded_by_target' });
      else if (target.record.memoryId !== record.memoryId) errors.push({ line: lineFor(index), code: 'superseded_by_memory_mismatch' });
    }
  });
  return errors;
}

function safePayload(record: MemoryRecord): string {
  return JSON.stringify(record)
    .replaceAll('--', '\\u002d\\u002d')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

export function formatMemoryMetadata(record: MemoryRecord): string {
  return `<!-- ${METADATA_PREFIX} ${safePayload(validateMemoryRecord(record))} -->`;
}

export function annotateMemoryBullet(text: string, record: MemoryRecord): string {
  return `${stripMemoryMetadataComment(text).trimEnd()} ${formatMemoryMetadata(record)}`;
}

export function memoryRecordHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Metadata deterministica per bullet legacy privi di commento. */
export function deriveLegacyMemoryRecord(relativePath: string, text: string, timestamp = Date.now(), occurrence = 0): MemoryRecord {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const digest = memoryRecordHash(`${relativePath}\0${normalized}\0${occurrence}`).slice(0, 32);
  return {
    memoryId: `mem_legacy_${digest}`,
    versionId: `ver_legacy_${digest}`,
    version: 1,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    entities: [],
    tags: [],
    supersedes: [],
    supersededBy: null,
  };
}
