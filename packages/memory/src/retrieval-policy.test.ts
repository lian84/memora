import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryService, formatMemoryMetadata, type MemoryRecord } from './index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    memoryId: 'mem_demo',
    versionId: 'ver_demo_1',
    version: 1,
    status: 'active',
    createdAt: 1,
    updatedAt: Date.now(),
    confidence: 0.9,
    importance: 0.8,
    salience: 0.8,
    project: 'Vega',
    tags: ['project_fact'],
    entities: [],
    supersedes: [],
    supersededBy: null,
    ...overrides,
  };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-retrieval-policy-'));
  dirs.push(dir);
  return dir;
}

function writeFile(dir: string, relativePath: string, heading: string, text: string, metadata: MemoryRecord) {
  const target = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `# ${heading}\n\n## Note\n\n- ${text} ${formatMemoryMetadata(metadata)}\n`);
}

describe('runtime retrieval policy', () => {
  it('filtra per progetto, tipo e confidenza', async () => {
    const dir = setup();
    writeFile(dir, 'projects/vega/memory.md', 'Vega', 'Vega usa PostgreSQL per i dati.', record({ memoryId: 'mem_vega', versionId: 'ver_vega', project: 'Vega', confidence: 0.95 }));
    writeFile(dir, 'projects/orione/memory.md', 'Orione', 'Orione usa PostgreSQL per i dati.', record({ memoryId: 'mem_orione', versionId: 'ver_orione', project: 'Orione', confidence: 0.4 }));
    writeFile(dir, 'projects/luna/memory.md', 'Luna', 'Luna usa MySQL per i dati.', record({ memoryId: 'mem_luna', versionId: 'ver_luna', project: 'Luna', tags: ['preference'], confidence: 0.9 }));
    const service = new MemoryService(dir, { searchMode: 'lexical', diversity: 0 });
    try {
      await service.initialize();
      await service.reindex();
      const byProject = await service.search('PostgreSQL', { project: 'Vega', topK: 5 });
      expect(byProject.every(result => result.memory?.every(memory => memory.project === 'Vega'))).toBe(true);
      expect(byProject.some(result => result.relativePath.includes('orione'))).toBe(false);

      const byType = await service.search('PostgreSQL', { memoryType: 'project_fact', minConfidence: 0.8, topK: 5 });
      expect(byType.some(result => result.relativePath.includes('vega'))).toBe(true);
      expect(byType.some(result => result.relativePath.includes('orione'))).toBe(false);
    } finally {
      await service.close();
    }
  });

  it('applica il budget token dopo il reranking', async () => {
    const dir = setup();
    const longText = (label: string) => `${label} ${'dettaglio '.repeat(40)}`;
    writeFile(dir, 'projects/vega/memory.md', 'Vega', longText('alpha'), record({ memoryId: 'mem_vega', versionId: 'ver_vega', project: 'Vega' }));
    writeFile(dir, 'projects/orione/memory.md', 'Orione', longText('alpha'), record({ memoryId: 'mem_orione', versionId: 'ver_orione', project: 'Orione' }));
    const service = new MemoryService(dir, { searchMode: 'lexical', diversity: 0 });
    try {
      await service.initialize();
      await service.reindex();
      const bounded = await service.search('alpha', { topK: 2, maxTokens: 80 });
      expect(bounded).toHaveLength(1);
      const unbounded = await service.search('alpha', { topK: 2, maxTokens: 1000 });
      expect(unbounded).toHaveLength(2);
    } finally {
      await service.close();
    }
  });

  it('accetta impostazioni di diversità live e non rompe la ricerca', async () => {
    const dir = setup();
    writeFile(dir, 'projects/vega/memory.md', 'Vega', 'Vega usa PostgreSQL.', record({ memoryId: 'mem_vega', versionId: 'ver_vega', project: 'Vega' }));
    const service = new MemoryService(dir, { searchMode: 'lexical' });
    try {
      await service.initialize();
      await service.reindex();
      service.setRetrievalDefaults({ diversity: 1, maxTokens: 500 });
      expect(service.getRetrievalDefaults()).toMatchObject({ diversity: 1, maxTokens: 500 });
      expect(await service.search('PostgreSQL')).toHaveLength(1);
    } finally {
      await service.close();
    }
  });
});
