import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MemoryService, resolveMemorySearchMode, type EmbeddingService, type MemorySearchMode } from './index.js';

class FakeEmbeddings implements EmbeddingService {
  available = false;
  calls = 0;
  constructor(private model = 'fake-v1', private fail = false) {}
  async initialize() { if (this.fail) throw new Error('missing model'); this.available = true; }
  isAvailable() { return this.available; }
  getModelInfo() { return { model: this.model, dimensions: 3 }; }
  async close() { this.available = false; }
  async embed(text: string) {
    const s = text.toLowerCase();
    return s.includes('vega') || s.includes('cromatica') ? new Float32Array([1, 0, 0])
      : s.includes('atlas') || s.includes('7319') ? new Float32Array([0, 1, 0]) : new Float32Array([0, 0, 1]);
  }
  async embedBatch(texts: string[]) { this.calls += texts.length; return Promise.all(texts.map(t => this.embed(t))); }
}

describe('hybrid memory', () => {
  const dirs: string[] = [];
  const services: MemoryService[] = [];
  function setup(provider?: FakeEmbeddings, hybrid = true, searchMode?: MemorySearchMode, warnings?: string[]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-hybrid-')); dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'projects'));
    fs.writeFileSync(path.join(dir, 'projects/vega.md'), '# Vega\n\nIl colore è turchese.');
    fs.writeFileSync(path.join(dir, 'projects/atlas.md'), '# Atlas\n\nIl codice è ZX-7319.');
    const service = new MemoryService(dir, { embeddings: provider, hybridSearchEnabled: hybrid, searchMode, warn: message => warnings?.push(message) }); services.push(service);
    return { dir, service };
  }
  function db(dir: string) { return new Database(path.join(dir, 'index/memora.sqlite'), { readonly: true }); }
  afterEach(async () => { for (const s of services.splice(0)) await s.close(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  it('resolves explicit, legacy, default and invalid modes deterministically', () => {
    const warnings: string[] = [];
    expect(resolveMemorySearchMode(undefined)).toBe('lexical');
    expect(resolveMemorySearchMode(undefined, true)).toBe('hybrid');
    expect(resolveMemorySearchMode('lexical', true)).toBe('lexical');
    expect(resolveMemorySearchMode('semantic', false)).toBe('semantic');
    expect(resolveMemorySearchMode('hybrid', false)).toBe('hybrid');
    expect(resolveMemorySearchMode('invalid', true, message => warnings.push(message))).toBe('lexical');
    expect(warnings).toHaveLength(1);
  });

  it.each(['lexical', 'semantic', 'hybrid'] as const)('uses the configured %s mode', async mode => {
    const provider = new FakeEmbeddings();
    const { service } = setup(provider, true, mode);
    await service.reindex();
    expect(service.getActiveSearchMode()).toBe(mode);
    const query = mode === 'semantic' ? 'scelta cromatica' : 'Vega cromatica';
    expect((await service.search(query))[0]).toMatchObject({ relativePath: 'projects/vega.md', retrievalMode: mode });
  });

  it.each(['semantic', 'hybrid'] as const)('%s falls back with a warning if the provider is unavailable', async mode => {
    for (const provider of [undefined, new FakeEmbeddings('missing', true)]) {
      const warnings: string[] = [];
      const { service } = setup(provider, false, mode, warnings);
      await service.reindex();
      expect(service.getActiveSearchMode()).toBe('lexical');
      expect((await service.search('ZX-7319'))[0]).toMatchObject({ relativePath: 'projects/atlas.md', retrievalMode: 'lexical' });
      expect(warnings).toHaveLength(1);
    }
  });

  it('disabled and unavailable preserve FTS fallback', async () => {
    for (const provider of [undefined, new FakeEmbeddings('missing', true)]) {
      const { service } = setup(provider);
      await service.reindex();
      const results = await service.search('ZX-7319');
      expect(results[0]?.relativePath).toBe('projects/atlas.md');
      expect(results[0]?.retrievalMode).toBe('lexical');
    }
  });

  it.each(['semantic', 'hybrid'] as const)('%s falls back to FTS if query inference fails', async mode => {
    const provider = new FakeEmbeddings();
    const { service } = setup(provider, false, mode);
    await service.reindex();
    provider.embed = async () => { throw new Error('inference failed'); };
    const results = await service.search('ZX-7319');
    expect(results[0]).toMatchObject({ relativePath: 'projects/atlas.md', retrievalMode: 'lexical' });
  });

  it('uses lexical fallback after a failed embedding batch and retries on reindex', async () => {
    const provider = new FakeEmbeddings();
    const { service } = setup(provider);
    const original = provider.embedBatch.bind(provider);
    provider.embedBatch = async () => { throw new Error('batch failed'); };
    await service.reindex();
    expect((await service.search('ZX-7319'))[0]?.retrievalMode).toBe('lexical');
    provider.embedBatch = original;
    await service.reindex();
    expect((await service.search('ZX-7319'))[0]?.retrievalMode).toBe('hybrid');
  });

  it('semantic and RRF hybrid retain lexical exact code', async () => {
    const { service } = setup(new FakeEmbeddings());
    await service.reindex();
    expect((await service.searchSemantic('scelta cromatica'))[0]?.relativePath).toBe('projects/vega.md');
    const hybrid = await service.search('Vega cromatica');
    expect(hybrid[0]).toMatchObject({ relativePath: 'projects/vega.md', retrievalMode: 'hybrid', lexicalRank: 1, semanticRank: 1, fusedRank: 1 });
    expect(hybrid[0]!.score).toBeCloseTo(2 / 61);
    expect((await service.search('ZX-7319'))[0]?.relativePath).toBe('projects/atlas.md');
  });

  it('reuses unchanged chunks when another section of a source changes', async () => {
    const provider = new FakeEmbeddings();
    const { dir, service } = setup(provider);
    const file = path.join(dir, 'projects/vega.md');
    fs.writeFileSync(file, '# Vega\n\nColore turchese.\n\n## Seconda\n\nOriginale.');
    await service.reindex();
    expect(provider.calls).toBe(3);
    fs.writeFileSync(file, '# Vega\n\nColore turchese.\n\n## Seconda\n\nNuovo.');
    await service.reindex();
    expect(provider.calls).toBe(4);
    expect(await service.searchLexical('Originale')).toHaveLength(0);
    expect((await service.searchLexical('Nuovo'))[0]?.content).toContain('Nuovo');
    expect((await service.searchLexical('turchese'))[0]?.relativePath).toBe('projects/vega.md');
  });

  it('updates retrieval mode and defaults live', async () => {
    const { service } = setup(new FakeEmbeddings(), false, 'lexical');
    await service.reindex();
    expect(service.getActiveSearchMode()).toBe('lexical');
    service.setSearchMode('semantic');
    service.setRetrievalDefaults({ topK: 1, maxChars: 1000 });
    expect(service.getActiveSearchMode()).toBe('semantic');
    expect(service.getRetrievalDefaults()).toMatchObject({ topK: 1, maxChars: 1000 });
    expect(await service.search('Vega')).toHaveLength(1);
  });

  it('persists, reuses, invalidates, deletes and rebuilds vectors', async () => {
    const provider = new FakeEmbeddings();
    const { dir, service } = setup(provider);
    await service.reindex();
    expect(provider.calls).toBe(2);
    await Promise.all([service.reindex(), service.reindex()]); expect(provider.calls).toBe(2);
    let conn = db(dir);
    expect(conn.prepare('select count(*) n from memory_embeddings').get()).toEqual({ n: 2 }); conn.close();
    fs.writeFileSync(path.join(dir, 'projects/vega.md'), '# Vega\n\nIl colore è blu.');
    await service.reindex(); expect(provider.calls).toBe(3);
    fs.unlinkSync(path.join(dir, 'projects/atlas.md'));
    await service.reindex();
    conn = db(dir); expect(conn.prepare('select count(*) n from memory_embeddings').get()).toEqual({ n: 1 }); conn.close();
    await service.close();
    const provider2 = new FakeEmbeddings();
    const restarted = new MemoryService(dir, { embeddings: provider2, hybridSearchEnabled: true }); services.push(restarted);
    await restarted.reindex(); expect(provider2.calls).toBe(0);
    expect((await restarted.searchSemantic('cromatica'))[0]?.relativePath).toBe('projects/vega.md');
    await restarted.close();
    const provider3 = new FakeEmbeddings('fake-v2');
    const changed = new MemoryService(dir, { embeddings: provider3, hybridSearchEnabled: true }); services.push(changed);
    await changed.initialize();
    expect(await changed.searchSemantic('cromatica')).toHaveLength(0);
    await changed.reindex(); expect(provider3.calls).toBe(1);
    await changed.close();
    fs.rmSync(path.join(dir, 'index'), { recursive: true, force: true });
    const provider4 = new FakeEmbeddings();
    const rebuilt = new MemoryService(dir, { embeddings: provider4 }); services.push(rebuilt);
    await rebuilt.reindex(); expect(provider4.calls).toBe(1);
  });
});
