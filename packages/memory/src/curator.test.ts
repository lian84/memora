import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryCurator, MemoryService, MemoryWriter, OpenRouterCuratorProvider, type CuratorInput, type MemoryCuratorProvider, type EmbeddingService } from './index.js';

const scores = { shouldRemember: true, ephemeral: false, importance: 0.9, durability: 0.9, futureUtility: 0.9, novelty: 0.9, confidence: 0.95 };
const proposal = (overrides: Record<string, unknown> = {}) => ({ ...scores, memoryType: 'project_fact', action: 'new', entity: { type: 'project', name: 'Vega' }, proposedText: 'Il progetto Vega usa il giallo.', currentText: null, target: { heading: 'Identità' }, rationale: 'Fatto durevole.', ...overrides });
class FakeProvider implements MemoryCuratorProvider {
  readonly model = 'fake';
  calls: CuratorInput[] = [];
  constructor(private output: unknown = proposal()) {}
  async analyze(input: CuratorInput): Promise<unknown> { this.calls.push(input); if (this.output instanceof Error) throw this.output; return this.output; }
  async complete(): Promise<unknown> { return { schemaVersion: 1, memories: [{ proposedText: 'Il progetto Vega usa MongoDB per la cache.', category: 'project', heading: 'Decisioni', action: 'new', rationale: 'Fatto durevole.', confidence: 0.9 }] }; }
}
class FakeEmbeddings implements EmbeddingService {
  available = false;
  async initialize() { this.available = true; }
  async embed() { return new Float32Array([1, 0, 0]); }
  async embedBatch(texts: string[]) { return texts.map(() => new Float32Array([1, 0, 0])); }
  getModelInfo() { return { model: 'fake-embeddings', dimensions: 3 }; }
  isAvailable() { return this.available; }
  async close() { this.available = false; }
}

describe('Memory Curator (offline fake provider)', () => {
  const dirs: string[] = [];
  const services: MemoryService[] = [];
  function setup(output: unknown = proposal(), searchFails = false) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-curator-')); dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'projects/vega'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'projects/vega/memory.md'), '# Vega\n\n## Identità\n\n- Vega usa il turchese.\n');
    const memory = new MemoryService(dir, { embeddings: new FakeEmbeddings(), searchMode: 'semantic' }); services.push(memory);
    const provider = new FakeProvider(output);
    const events: string[] = [];
    const search = searchFails ? { search: async () => { throw new Error('fail'); } } : memory;
    const curator = new MemoryCurator(provider, search, { log: event => events.push(event.event) });
    const writer = new MemoryWriter({ dataDir: dir, memoryService: memory, curator });
    return { dir, memory, provider, events, writer, curator };
  }
  afterEach(async () => { vi.unstubAllGlobals(); for (const service of services.splice(0)) await service.close(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

  it('uses a separate configurable OpenRouter model with structured JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(proposal()) } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenRouterCuratorProvider('provider/curator-model', 'test-only-key');
    expect(await provider.analyze({ userText: 'Vega usa il giallo', recentUserMessages: [], existingMemory: [], existingBullets: [], explicit: false })).toMatchObject({ shouldRemember: true });
    const request = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    const requestBody = JSON.parse(request[1].body as string);
    expect(requestBody).toMatchObject({ model: 'provider/curator-model', reasoning: { effort: 'low' }, response_format: { type: 'json_object' } });
    expect(requestBody.messages[0].content).toContain('complete canonical FINAL state');
    expect(requestBody.messages[0].content).toContain('updateIntent');
    expect(requestBody.messages[0].content).toContain('existingMemory');
    expect(requestBody.messages[0].content).toContain('untrusted data');
  });

  it('accepts one memory inside a wrapper but rejects unsupported multiple memories', async () => {
    const chosen = proposal({ action: 'update', updateIntent: 'augment', currentText: 'Vega usa il turchese.', proposedText: 'Vega usa il turchese e il giallo.' });
    const wrapped = setup({ shouldRemember: true, ephemeral: false, memories: [chosen] });
    await wrapped.memory.reindex();
    expect((await wrapped.writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo anche il giallo.' })).created).toHaveLength(1);
    const multiple = setup({ shouldRemember: true, ephemeral: false, memories: [chosen, chosen] });
    await multiple.memory.reindex();
    expect((await multiple.writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo anche il giallo.' })).created).toHaveLength(0);
    expect(multiple.events).toContain('curator_validation_failure');
  });

  it('estrae proposte atomiche dalla risposta assistente con il contesto', async () => {
    const { writer } = setup();
    const proposals = await writer.proposeAssistantMemories({
      assistantText: 'Per la cache di Vega conviene usare MongoDB.',
      question: 'Cosa usiamo per la cache di Vega?',
      context: ['Utente: Il progetto Vega usa il turchese.', 'Pi: Ok.'],
      projectId: 'vega',
    });
    expect(proposals).toEqual([
      expect.objectContaining({ proposedText: 'Il progetto Vega usa MongoDB per la cache.', action: 'new', projectId: 'vega' }),
    ]);
  });

  it('creates an automatic project candidate without writing Markdown', async () => {
    const { writer, memory, dir } = setup(); await memory.reindex();
    const candidate = (await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo il giallo.' })).created[0];
    expect(candidate).toMatchObject({ action: 'new', origin: 'automatic', targetPath: 'projects/vega/memory.md', curatorProvider: 'custom', curatorModel: 'fake' });
    expect(candidate?.salienceScore).toBeCloseTo(0.91);
    expect(fs.readFileSync(path.join(dir, 'projects/vega/memory.md'), 'utf8')).not.toContain('giallo');
    const reloaded = new MemoryWriter({ dataDir: dir, memoryService: memory });
    expect(await reloaded.getCandidate(candidate!.id)).toMatchObject({ id: candidate!.id });
  });

  it('updates one confirmed existing bullet, reindexes and supports semantic retrieval', async () => {
    const { writer, memory, dir } = setup(proposal({ action: 'update', updateIntent: 'augment', currentText: 'Vega usa il turchese.', proposedText: 'Vega usa il turchese e il giallo.' }));
    await memory.reindex();
    const [candidate] = (await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo anche il giallo.' })).created;
    expect(candidate).toMatchObject({ action: 'update', updateIntent: 'augment', currentText: 'Vega usa il turchese.' });
    await writer.approve(candidate!.id);
    const text = fs.readFileSync(path.join(dir, 'projects/vega/memory.md'), 'utf8');
    expect(text).toContain('- Vega usa il turchese e il giallo.');
    expect(text).toContain('"status":"superseded"');
    expect(text).toContain('"status":"active"');
    expect(text).toContain('"memoryId":"mem_legacy_');
    const results = await memory.search('giallo');
    expect(results.some(row => row.content.includes('giallo'))).toBe(true);
    expect(results.some(row => row.memory?.some(record => record.status === 'active' && record.memoryId.startsWith('mem_legacy_')))).toBe(true);
  });

  it('REPLACE substitutes only the invalidated value', async () => {
    const { writer, memory, dir } = setup(proposal({ action: 'update', updateIntent: 'replace', currentText: 'Vega usa il turchese.', proposedText: 'Vega usa il rosso come colore identificativo.' }));
    await memory.reindex();
    const [candidate] = (await writer.processTurn({ sessionId: 's', userText: 'Non useremo più il turchese; passeremo al rosso.' })).created;
    expect(candidate).toMatchObject({ action: 'update', updateIntent: 'replace' });
    await writer.approve(candidate!.id);
    const text = fs.readFileSync(path.join(dir, 'projects/vega/memory.md'), 'utf8');
    expect(text).toContain('- Vega usa il rosso come colore identificativo.');
    expect(text).toContain('"status":"superseded"');
    expect(text).toContain('- Vega usa il turchese.');
    expect((await memory.search('turchese')).every(row => !row.content.includes('turchese'))).toBe(true);
  });

  it('CORRECT replaces a mistaken value and approval updates the index', async () => {
    const { writer, memory, dir } = setup(proposal({
      action: 'update', updateIntent: 'correct', memoryType: 'project_fact',
      entity: { type: 'project', name: 'Orione' }, currentText: 'Orione utilizza MySQL.',
      proposedText: 'Orione utilizza PostgreSQL come database.',
    }));
    fs.mkdirSync(path.join(dir, 'projects/orione'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'projects/orione/memory.md'), '# Orione\n\n## Stack\n\n- Orione utilizza MySQL.\n');
    await memory.reindex();
    const [candidate] = (await writer.processTurn({ sessionId: 's', userText: 'Correzione: per Orione abbiamo scelto PostgreSQL.' })).created;
    expect(candidate).toMatchObject({ action: 'update', updateIntent: 'correct', targetPath: 'projects/orione/memory.md' });
    await writer.approve(candidate!.id);
    expect(fs.readFileSync(path.join(dir, 'projects/orione/memory.md'), 'utf8')).toContain('- Orione utilizza PostgreSQL come database.');
    expect((await memory.search('PostgreSQL')).some(row => row.content.includes('PostgreSQL'))).toBe(true);
  });

  it('AUGMENT preserves compatible details and adds a version', async () => {
    const { writer, memory, dir } = setup(proposal({
      action: 'update', updateIntent: 'augment', memoryType: 'project_fact',
      entity: { type: 'project', name: 'PEKIT' }, currentText: 'PEKIT usa CodeIgniter.',
      proposedText: 'PEKIT usa CodeIgniter 4.7.5.',
    }));
    fs.mkdirSync(path.join(dir, 'projects/pekit'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'projects/pekit/memory.md'), '# PEKIT\n\n## Stack\n\n- PEKIT usa CodeIgniter.\n');
    await memory.reindex();
    const [candidate] = (await writer.processTurn({ sessionId: 's', userText: 'PEKIT usa CodeIgniter versione 4.7.5.' })).created;
    await writer.approve(candidate!.id);
    expect(fs.readFileSync(path.join(dir, 'projects/pekit/memory.md'), 'utf8')).toContain('- PEKIT usa CodeIgniter 4.7.5.');
  });

  it('updates Curator thresholds live for the next turn', async () => {
    const { writer, memory, curator } = setup(proposal({ importance: 0.6, durability: 0.6, futureUtility: 0.6, novelty: 0.6, confidence: 0.6 }));
    await memory.reindex();
    expect((await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo il giallo.' })).created).toHaveLength(0);
    curator.updateRuntimeConfig({ minConfidence: 0.55, minSalience: 0.55 });
    expect((await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo il giallo.' })).created).toHaveLength(1);
  });

  it('AUGMENT never silently drops compatible facts from the final state', async () => {
    const { writer, memory, dir, events } = setup(proposal({
      action: 'update', updateIntent: 'augment', currentText: 'Vega usa il turchese e supporta il tema scuro.',
      proposedText: 'Vega usa il giallo come secondo colore.',
    }));
    fs.writeFileSync(path.join(dir, 'projects/vega/memory.md'), '# Vega\n\n- Vega usa il turchese e supporta il tema scuro.\n');
    await memory.reindex();
    expect((await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo anche il giallo.' })).created).toHaveLength(0);
    expect(events).toContain('curator_validation_failure');
    expect(fs.readFileSync(path.join(dir, 'projects/vega/memory.md'), 'utf8')).toContain('tema scuro');
  });

  it('rejects an UPDATE delta that is not standalone', async () => {
    const { writer, memory, events } = setup(proposal({
      action: 'update', updateIntent: 'augment', currentText: 'Vega usa il turchese.',
      proposedText: 'Anche il giallo come secondo colore.',
    }));
    await memory.reindex();
    expect((await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo anche il giallo.' })).created).toHaveLength(0);
    expect(events).toContain('curator_validation_failure');
  });

  it('requires an explicit updateIntent and sends existingMemory to the provider', async () => {
    const missing = setup(proposal({ action: 'update', currentText: 'Vega usa il turchese.', proposedText: 'Vega usa il turchese e il giallo.' }));
    await missing.memory.reindex();
    expect((await missing.writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo anche il giallo.' })).created).toHaveLength(0);
    expect(missing.events).toContain('curator_validation_failure');
    const valid = setup(proposal({ action: 'update', updateIntent: 'augment', currentText: 'Vega usa il turchese.', proposedText: 'Vega usa il turchese e il giallo.' }));
    await valid.memory.reindex();
    await valid.writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo anche il giallo.' });
    expect(valid.provider.calls[0]?.existingMemory.some(item => item.content.includes('Vega usa il turchese.'))).toBe(true);
    expect(valid.provider.calls[0]?.existingBullets).toContain('Vega usa il turchese.');
  });

  it('does not replace a matching bullet that moved into a code fence', async () => {
    const { writer, memory, dir } = setup(proposal({ action: 'update', updateIntent: 'augment', currentText: 'Vega usa il turchese.', proposedText: 'Vega usa il turchese e il giallo.' })); await memory.reindex();
    const [candidate] = (await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo anche il giallo.' })).created;
    fs.writeFileSync(path.join(dir, 'projects/vega/memory.md'), '# Vega\n\n```text\n- Vega usa il turchese.\n```\n');
    await expect(writer.approve(candidate!.id)).rejects.toMatchObject({ code: 'memory_changed' });
  });

  it('refuses an update if the source changed before approval', async () => {
    const { writer, memory, dir } = setup(proposal({ action: 'update', updateIntent: 'augment', currentText: 'Vega usa il turchese.', proposedText: 'Vega usa il turchese e il giallo.' })); await memory.reindex();
    const [candidate] = (await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo anche il giallo.' })).created;
    fs.writeFileSync(path.join(dir, 'projects/vega/memory.md'), '# Vega\n\n- Contenuto cambiato.\n');
    await expect(writer.approve(candidate!.id)).rejects.toMatchObject({ code: 'memory_changed' });
    expect(fs.readFileSync(path.join(dir, 'projects/vega/memory.md'), 'utf8')).toContain('Contenuto cambiato');
  });

  it('instrada i fatti di progetto nel progetto della sessione', async () => {
    const { writer, memory } = setup(proposal({
      memoryType: 'project_fact', entity: { type: 'project', name: 'Orione' },
      proposedText: 'Orione usa PostgreSQL.', target: { heading: 'Database' },
    }));
    await memory.reindex();
    const [candidate] = (await writer.processTurn({
      sessionId: 's', projectId: 'orione', userText: 'Per Orione useremo PostgreSQL.',
    })).created;
    expect(candidate).toMatchObject({ projectId: 'orione', targetPath: 'projects/orione/memory.md' });
  });

  it.each([
    ['preference', { type: 'user', name: '' }, 'memory/preferences.md', 'Preferisco Tailscale per i server.'],
    ['profile_fact', { type: 'user', name: '' }, 'memory/profile.md', 'Il mio Mac è un Air M4.'],
    ['project_decision', { type: 'project', name: 'Orione' }, 'projects/orione/memory.md', 'Abbiamo deciso PostgreSQL per Orione.'],
    ['workflow', { type: 'user', name: '' }, 'memory/workflows.md', 'I report sono in italiano.'],
    ['goal', { type: 'user', name: '' }, 'memory/goals.md', 'Il mio obiettivo è studiare.'],
  ])('routes %s without accepting an LLM path', async (memoryType, entity, targetPath, userText) => {
    const { writer, memory } = setup(proposal({ memoryType, entity, target: { heading: 'Note', path: '../../secret.md' } })); await memory.reindex();
    const [candidate] = (await writer.processTurn({ sessionId: 's', userText })).created;
    expect(candidate?.targetPath).toBe(targetPath);
  });

  it('skips trivial turns, ephemeral facts and high-confidence duplicates', async () => {
    const { writer, memory, provider, events } = setup(); await memory.reindex();
    expect((await writer.processTurn({ sessionId: 's', userText: 'Grazie, perfetto.' })).created).toHaveLength(0);
    expect(provider.calls).toHaveLength(0); expect(events).toContain('curator_skipped_prefilter');
    const ephemeral = setup(proposal({ shouldRemember: false, ephemeral: true })); await ephemeral.memory.reindex();
    expect((await ephemeral.writer.processTurn({ sessionId: 's', userText: 'Il PID è 3812.' })).created).toHaveLength(0);
    const duplicate = setup(proposal({ action: 'duplicate', novelty: 0 })); await duplicate.memory.reindex();
    expect((await duplicate.writer.processTurn({ sessionId: 's', userText: 'Vega usa il turchese.' })).created).toHaveLength(0);
    expect(duplicate.events).toContain('curator_duplicate');
  });

  it('does not discard an ok followed by a durable decision', async () => {
    const { writer, memory, provider } = setup(); await memory.reindex();
    expect((await writer.processTurn({ sessionId: 's', userText: 'Ok, allora per Vega usiamo PostgreSQL.' })).created).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it('uses separate confidence and salience thresholds for useful updates', async () => {
    const { writer, memory } = setup(proposal({ action: 'update', updateIntent: 'augment', currentText: 'Vega usa il turchese.', proposedText: 'Vega usa il turchese e il giallo.', importance: 0.75, durability: 0.75, futureUtility: 0.75, novelty: 0.55, confidence: 0.9 }));
    await memory.reindex();
    const [candidate] = (await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo anche il giallo.' })).created;
    expect(candidate).toMatchObject({ action: 'update', confidenceScore: 0.9 });
    expect(candidate?.salienceScore).toBeCloseTo(0.74);
  });

  it('uses bounded prior user context, never assistant claims, and marks ambiguous updates conflict', async () => {
    const { writer, memory, provider } = setup(proposal({ action: 'update', updateIntent: 'augment', currentText: 'Fatto non esistente', proposedText: 'Vega usa il turchese e il giallo.' })); await memory.reindex();
    const [candidate] = (await writer.processTurn({ sessionId: 's', userText: 'Aggiungiamo anche il giallo.', recentUserMessages: ['Per Vega useremo il turchese.'], assistantText: 'Affermazione inventata' })).created;
    expect(candidate).toMatchObject({ status: 'conflict', action: 'conflict' });
    expect(provider.calls[0]?.recentUserMessages).toEqual(['Per Vega useremo il turchese.']);
    expect(JSON.stringify(provider.calls)).not.toContain('Affermazione inventata');
  });

  it('explicit requests retain priority and bypass salience threshold', async () => {
    const { writer, memory } = setup(proposal({ confidence: 0.1, novelty: 0.1 })); await memory.reindex();
    const [candidate] = (await writer.processTurn({ sessionId: 's', userText: 'Ricorda che Vega usa il giallo.' })).created;
    expect(candidate).toMatchObject({ origin: 'explicit', priority: 'high', targetPath: 'projects/vega/memory.md' });
  });

  it('blocks secrets before external provider and preserves explicit redaction policy', async () => {
    const { writer, memory, provider } = setup(); await memory.reindex();
    expect((await writer.processTurn({ sessionId: 's', userText: 'La password è molto segreta.' })).created).toHaveLength(0);
    const [candidate] = (await writer.processTurn({ sessionId: 's', userText: 'Ricorda che la password è segreta.' })).created;
    expect(candidate).toMatchObject({ sensitive: true, status: 'rejected', proposedText: '[contenuto sensibile rimosso]' });
    expect(provider.calls).toHaveLength(0);
  });

  it('redacts PII before the provider and rejects proposals containing personal data', async () => {
    const { writer, memory, provider, events } = setup(proposal({
      proposedText: 'Vega usa l\'email mario@example.com.',
    }));
    await memory.reindex();
    const result = await writer.processTurn({
      sessionId: 's',
      userText: 'Per Vega usa l\'email mario@example.com e il giallo.',
      recentUserMessages: ['Chiamami al +39 333 123 4567.'],
    });
    expect(result.created).toHaveLength(0);
    expect(events).toContain('curator_validation_failure');
    const sent = JSON.stringify(provider.calls);
    expect(sent).not.toContain('mario@example.com');
    expect(sent).not.toContain('333 123 4567');
    expect(sent).toContain('[email-rimossa]');
    expect(sent).toContain('[telefono-rimosso]');
  });

  it('esclude dalla richiesta remota le memorie che contengono PII', async () => {
    const { writer, memory, provider, dir } = setup();
    fs.writeFileSync(path.join(dir, 'projects/vega/memory.md'), '# Vega\n\n## Contatti\n\n- Contatto Vega: 333 123 4567.\n- Vega usa il turchese.\n');
    await memory.reindex();
    await writer.processTurn({ sessionId: 's', userText: 'Per Vega aggiorna i contatti e il colore.' });
    expect(provider.calls).toHaveLength(1);
    expect(JSON.stringify(provider.calls)).not.toContain('333 123 4567');
  });

  it('skips invalid JSON, invalid scores and provider errors; explicit fallback stays available', async () => {
    for (const output of [null, proposal({ confidence: 4 }), new Error('offline')]) {
      const { writer, memory, events } = setup(output); await memory.reindex();
      expect((await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo il giallo.' })).created).toHaveLength(0);
      expect(events.some(event => event === 'curator_provider_failure' || event === 'curator_validation_failure')).toBe(true);
      expect((await writer.processTurn({ sessionId: 's', userText: 'Ricorda che il progetto Vega usa il giallo.' })).created[0]).toMatchObject({ origin: 'explicit', priority: 'high' });
    }
  });

  it('reports persistence failures without logging private content', async () => {
    const { writer, memory, dir, events } = setup(); await memory.reindex();
    fs.writeFileSync(path.join(dir, 'memory-inbox'), 'not a directory');
    expect((await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo il giallo.' })).created).toHaveLength(0);
    expect(events).toContain('curator_persistence_failure');
    expect(JSON.stringify(events)).not.toContain('giallo');
  });

  it('continues cautiously when memory search fails', async () => {
    const { writer, memory, events } = setup(proposal(), true); await memory.reindex();
    expect((await writer.processTurn({ sessionId: 's', userText: 'Per Vega useremo il giallo.' })).created).toHaveLength(1);
    expect(events).toContain('curator_search_failure');
  });
});
