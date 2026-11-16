import { describe, expect, it } from 'vitest';
import { MemoryConsolidator, type MemoryCuratorProvider } from './index.js';

class FakeProvider implements MemoryCuratorProvider {
  readonly model = 'fake-consolidator';
  readonly provider = 'openrouter';
  calls = 0;
  constructor(private output: unknown) {}
  async analyze() { return {}; }
  async complete() { this.calls++; return this.output; }
}

const records = [
  { memoryId: 'mem_a', versionId: 'ver_a', relativePath: 'projects/vega/memory.md', text: 'Vega usa PostgreSQL.', project: 'Vega', confidence: 0.9, updatedAt: 1 },
  { memoryId: 'mem_b', versionId: 'ver_b', relativePath: 'projects/vega/memory.md', text: 'Il database di Vega è Postgres.', project: 'Vega', confidence: 0.8, updatedAt: 2 },
];

describe('MemoryConsolidator', () => {
  it('produce un report schema v1 senza scrivere', async () => {
    const provider = new FakeProvider({ schemaVersion: 1, decisions: [{ kind: 'duplicate', memoryIds: ['mem_a', 'mem_b'], recommendedText: 'Vega usa PostgreSQL.', confidence: 0.9 }] });
    const report = await new MemoryConsolidator(provider).analyze(records);
    expect(report).toMatchObject({ schemaVersion: 1, provider: 'openrouter', model: 'fake-consolidator' });
    expect(report.decisions[0]).toMatchObject({ kind: 'duplicate', memoryIds: ['mem_a', 'mem_b'] });
    expect(provider.calls).toBe(1);
  });

  it('scarta id inventati e schema non valido', async () => {
    const invalid = new FakeProvider({ schemaVersion: 2, decisions: [] });
    await expect(new MemoryConsolidator(invalid).analyze(records)).rejects.toThrow('consolidation_invalid_schema');
    const invented = new FakeProvider({ schemaVersion: 1, decisions: [{ kind: 'conflict', memoryIds: ['mem_a', 'other'] }] });
    const report = await new MemoryConsolidator(invented).analyze(records);
    expect(report.decisions).toEqual([]);
  });

  it('non chiama il provider con meno di due memorie', async () => {
    const provider = new FakeProvider({ schemaVersion: 1, decisions: [] });
    const report = await new MemoryConsolidator(provider).analyze([records[0]!]);
    expect(report.decisions).toEqual([]);
    expect(provider.calls).toBe(0);
  });
});
