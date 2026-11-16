import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  annotateMemoryBullet,
  deriveLegacyMemoryRecord,
  formatMemoryMetadata,
  matchingMemoryBulletLines,
  MemoryService,
  parseMemoryMetadata,
  replaceMemoryBullet,
  stripMemoryMetadataComment,
  stripSupersededMemoryLines,
  validateMemoryRecordReferences,
  writeMemoryMarkdown,
  type MemoryRecord,
} from './index.js';

const record: MemoryRecord = {
  memoryId: 'mem_vega_database',
  versionId: 'ver_vega_database_1',
  version: 1,
  status: 'active',
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_001_000,
  sourceSessionId: 'session-vega',
  sourceMessageId: 'message-vega',
  sourceTurnId: 'turn-vega',
  sourceTimestamp: 1_759_999_000_000,
  confidence: 0.91,
  scope: 'project:vega',
  project: 'Vega -- <core>',
  entities: [{ type: 'project', name: 'Vega' }],
  tags: ['project_fact', 'database'],
  curatorProvider: 'opencode-go',
  curatorModel: 'nvidia/model:free',
  supersedes: [],
  supersededBy: null,
};

function nextRecord(previous: MemoryRecord): MemoryRecord {
  return {
    ...previous,
    versionId: 'ver_vega_database_2',
    version: 2,
    updatedAt: 1_760_000_002_000,
    sourceSessionId: 'session-update',
    sourceMessageId: 'message-update',
    tags: ['project_fact', 'replace'],
    supersedes: [previous.versionId],
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('memory metadata', () => {
  it('serializza e rilegge una versione con provenienza completa', () => {
    const line = annotateMemoryBullet('- Il progetto Vega usa PostgreSQL.', record);
    expect(line).toContain('<!-- memora-memory:v1 ');
    expect(line).not.toContain('-- >');
    const parsed = parseMemoryMetadata(line);
    expect(parsed.errors).toEqual([]);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.record).toMatchObject(record);
    expect(parsed.records[0]?.record.project).toBe('Vega -- <core>');
    expect(stripMemoryMetadataComment(line)).toBe('- Il progetto Vega usa PostgreSQL.');
  });

  it('distingue JSON invalido e riferimenti di versione mancanti', () => {
    expect(parseMemoryMetadata('<!-- memora-memory:v1 {bad} -->').errors[0]?.code).toBe('invalid_json');
    const superseded: MemoryRecord = { ...record, status: 'superseded', supersededBy: 'ver_missing' };
    const errors = validateMemoryRecordReferences([superseded]);
    expect(errors.map(error => error.code)).toEqual(expect.arrayContaining(['missing_superseded_by_target']));
  });

  it('valida una catena active/superseded e ignora le versioni storiche nel contesto', () => {
    const next = nextRecord(record);
    const old = { ...record, status: 'superseded' as const, supersededBy: next.versionId, updatedAt: next.updatedAt };
    const content = [
      `- Il progetto Vega usa PostgreSQL. ${formatMemoryMetadata(old)}`,
      `- Il progetto Vega usa MySQL. ${formatMemoryMetadata(next)}`,
    ].join('\n');
    const parsed = parseMemoryMetadata(content);
    expect(parsed.errors).toEqual([]);
    expect(parsed.records).toHaveLength(2);
    expect(stripSupersededMemoryLines(content).split('\n')[0]).toBe('');
    expect(stripSupersededMemoryLines(content).split('\n')).toHaveLength(2);
  });

  it('mantiene ID e catena durante la sostituzione del bullet', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-metadata-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'projects/vega'), { recursive: true });
    const target = 'projects/vega/memory.md';
    await writeMemoryMarkdown(dir, target, 'Database', 'Il progetto Vega usa PostgreSQL.', record);
    const next = nextRecord(record);
    const result = await replaceMemoryBullet(dir, target, 'Il progetto Vega usa PostgreSQL.', 'Il progetto Vega usa MySQL.', { previous: record, next });
    expect(result.changed).toBe(true);

    const content = fs.readFileSync(path.join(dir, target), 'utf8');
    expect(content).toContain('Il progetto Vega usa PostgreSQL.');
    expect(content).toContain('Il progetto Vega usa MySQL.');
    expect(content.match(/"status":"superseded"/g)).toHaveLength(1);
    expect(content.match(/"status":"active"/g)).toHaveLength(1);
    const parsed = parseMemoryMetadata(content);
    expect(parsed.errors).toEqual([]);
    expect(parsed.records.map(item => item.record.memoryId)).toEqual([record.memoryId, record.memoryId]);
    expect(matchingMemoryBulletLines(content, 'Il progetto Vega usa MySQL.')).toHaveLength(1);
  });


  it('indicizza solo la versione attiva e segnala metadata invalidi', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-metadata-index-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'projects/vega'), { recursive: true });
    const next = nextRecord(record);
    const old = { ...record, status: 'superseded' as const, supersededBy: next.versionId, updatedAt: next.updatedAt };
    fs.writeFileSync(path.join(dir, 'projects/vega/memory.md'), [
      '# Vega',
      '',
      `- Vega usa il turchese. ${formatMemoryMetadata(old)}`,
      `- Vega usa il rosso. ${formatMemoryMetadata(next)}`,
      '',
      '- Fatto con metadata rotto. <!-- memora-memory:v1 {bad} -->',
    ].join('\n'));
    const warnings: string[] = [];
    const service = new MemoryService(dir, { searchMode: 'lexical', warn: message => warnings.push(message) });
    try {
      await service.initialize();
      await service.reindex();
      const turchese = await service.search('turchese');
      const rosso = await service.search('rosso');
      expect(turchese).toHaveLength(0);
      expect(rosso).toHaveLength(1);
      expect(rosso[0]?.memory?.[0]).toMatchObject({ memoryId: record.memoryId, status: 'active', sourceSessionId: 'session-update' });
      expect(rosso[0]?.content).not.toContain('memora-memory');
      const history = await service.searchHistory('turchese', { relativePaths: ['projects/vega/memory.md'], fallbackToLatest: true });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ status: 'superseded', text: 'Vega usa il turchese.' });
      const fallback = await service.searchHistory('prima di mysql implementava altro?', { relativePaths: ['projects/vega/memory.md'], fallbackToLatest: true });
      expect(fallback).toHaveLength(1);
      expect(fallback[0]?.text).toBe('Vega usa il turchese.');
      const sources = await service.listSources();
      const sourceHistory = await service.getSourceHistory(sources[0]!.id);
      expect(sourceHistory).toHaveLength(2);
      expect(sourceHistory.map(record => record.status).sort()).toEqual(['active', 'superseded']);
      expect(warnings.some(message => message.includes('invalid_json'))).toBe(true);
      expect(warnings.join(' ')).not.toContain('Fatto con metadata rotto');
    } finally {
      await service.close();
    }
  });

  it('genera ID legacy distinti per occorrenze diverse', () => {
    const first = deriveLegacyMemoryRecord('memory/profile.md', 'Uso Debian.', 1, 1);
    const second = deriveLegacyMemoryRecord('memory/profile.md', 'Uso Debian.', 1, 2);
    expect(first.memoryId).not.toBe(second.memoryId);
    expect(first.status).toBe('active');
  });
});
