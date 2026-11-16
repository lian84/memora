import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MemoryService } from './index';
import { MemoryDatabase } from './database';
import { scanMarkdown } from './scanner';
import { chunkMarkdown } from './chunker';

describe('MemoryService', () => {
  let tmpDir: string;
  let service: MemoryService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-memory-test-'));
    fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'journal'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'documents'), { recursive: true });
    service = new MemoryService(tmpDir);
    await service.initialize();
  });

  afterEach(async () => {
    await service.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dovrebbe creare il database SQLite con FTS5', async () => {
    const dbPath = path.join(tmpDir, 'index', 'memora.sqlite');
    expect(fs.existsSync(dbPath)).toBe(true);

    const stats = service.getStats();
    expect(stats.sourceCount).toBe(0);
    expect(stats.chunkCount).toBe(0);
  });

  it('dovrebbe indicizzare file Markdown', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'memory', 'test.md'),
      '# Test\n\nQuesto è un contenuto di test per il memory service.\n\n## Sottosezione\n\nAltro contenuto qui.'
    );

    await service.reindex();

    const sources = await service.listSources();
    expect(sources.length).toBe(1);
    expect(sources[0].category).toBe('memory');
    expect(sources[0].relativePath).toBe('memory/test.md');
  });

  it('dovrebbe fare search con risultati', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'projects', 'aurora.md'),
      '# Progetto Aurora\n\nIl progetto Aurora utilizza il codice interno ZX-7319.\n\nÈ un progetto di ricerca avanzata.'
    );

    await service.reindex();

    const results = await service.search('ZX-7319', { topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('ZX-7319');
    expect(results[0].relativePath).toBe('projects/aurora.md');
    expect(results[0].category).toBe('projects');
  });

  it('dovrebbe supportare query FTS5 multi-termine', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'projects', 'aurora-multiterm.md'),
      '# Progetto Aurora\n\nIl progetto Aurora utilizza il codice interno ZX-7319.'
    );

    await service.reindex();

    const results = await service.search('codice interno Aurora', { topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].relativePath).toBe('projects/aurora-multiterm.md');
    expect(results[0].heading).toBe('Progetto Aurora');
    expect(results[0].content).toContain('ZX-7319');

    const promptResults = await service.search(
      'Qual è il codice interno del progetto Aurora?',
      { topK: 5 }
    );
    expect(promptResults.length).toBeGreaterThan(0);
    expect(promptResults[0].relativePath).toBe('projects/aurora-multiterm.md');
    expect(promptResults[0].content).toContain('ZX-7319');
  });

  it('dovrebbe restituire risultati vuoti per search senza match', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'memory', 'test.md'),
      '# Test\n\nContenuto senza corrispondenze.'
    );

    await service.reindex();

    const results = await service.search('xyz123nonexistent', { topK: 5 });
    expect(results.length).toBe(0);
  });

  it('dovrebbe gestire file aggiunti dopo il primo reindex', async () => {
    await service.reindex();
    expect((await service.listSources()).length).toBe(0);

    fs.writeFileSync(
      path.join(tmpDir, 'memory', 'nuovo.md'),
      '# Nuovo\n\nContenuto nuovo.'
    );

    await service.reindex();
    const sources = await service.listSources();
    expect(sources.length).toBe(1);
    expect(sources[0].relativePath).toBe('memory/nuovo.md');
  });

  it('dovrebbe gestire file modificati', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'memory', 'modificato.md'),
      '# Originale\n\nContenuto originale.'
    );
    await service.reindex();

    fs.writeFileSync(
      path.join(tmpDir, 'memory', 'modificato.md'),
      '# Modificato\n\nContenuto modificato con nuove informazioni.'
    );
    await service.reindex();

    const sources = await service.listSources();
    expect(sources.length).toBe(1);
    expect(sources[0].relativePath).toBe('memory/modificato.md');

    const results = await service.search('modificato', { topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('modificato');
  });

  it('dovrebbe gestire file eliminati', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'memory', 'daeliminare.md'),
      '# Da eliminare\n\nQuesto sarà rimosso.'
    );
    await service.reindex();
    expect((await service.listSources()).length).toBe(1);

    fs.rmSync(path.join(tmpDir, 'memory', 'daeliminare.md'));
    await service.reindex();

    const sources = await service.listSources();
    expect(sources.length).toBe(0);
  });

  it('dovrebbe essere idempotente (reindex multiplo)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'memory', 'idempotente.md'),
      '# Idempotente\n\nContenuto che non cambia.'
    );

    await service.reindex();
    const count1 = service.getStats().chunkCount;

    await service.reindex();
    const count2 = service.getStats().chunkCount;

    expect(count1).toBe(count2);
    expect(count1).toBeGreaterThan(0);
  });

  it('dovrebbe respingere path traversal', async () => {
    // Crea un file fuori dalla data directory
    const outsidePath = path.join(os.tmpdir(), 'memora-outside.md');
    fs.writeFileSync(outsidePath, '# Contenuto esterno\n\nNon dovrebbe essere indicizzato.');

    // Prova a creare un symlink che punta fuori
    const symlinkPath = path.join(tmpDir, 'memory', 'escape.md');
    try {
      fs.symlinkSync(outsidePath, symlinkPath);
    } catch {
      // Se non si possono creare symlink, skip
    }

    await service.reindex();

    const sources = await service.listSources();
    // Non dovrebbe esserci nessun file proveniente da fuori
    const outsideSources = sources.filter((s) => !s.relativePath.startsWith('memory/'));
    expect(outsideSources.length).toBe(0);

    // Pulizia
    try {
      fs.rmSync(outsidePath, { force: true });
    } catch {
      // ignore
    }
  });

  it('dovrebbe supportare DB cancellato e ricostruito', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'memory', 'persistente.md'),
      '# Persistente\n\nQuesto contenuto deve sopravvivere al rebuild.'
    );
    await service.reindex();
    expect((await service.listSources()).length).toBe(1);

    // Cancella il database
    await service.close();
    const dbPath = path.join(tmpDir, 'index', 'memora.sqlite');
    fs.rmSync(dbPath, { force: true });

    // Ricrea il servizio e reindicizza
    service = new MemoryService(tmpDir);
    await service.initialize();
    await service.reindex();

    const sources = await service.listSources();
    expect(sources.length).toBe(1);
    expect(sources[0].relativePath).toBe('memory/persistente.md');
  });

  it('dovrebbe fare chunking deterministico', async () => {
    const content = '# Titolo\n\nParagrafo uno.\n\nParagrafo due.\n\n## Sottotitolo\n\nParagrafo tre.';
    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].heading).toBe('Titolo');
    expect(chunks[0].content).toContain('Paragrafo uno');
  });

  it('ricostruisce i chunk di un indice precedente anche quando il Markdown è invariato', async () => {
    const content = '## Preferenze\n\n- Preferisce Tailscale.\n- Preferisce risposte concise.\n';
    fs.writeFileSync(path.join(tmpDir, 'memory', 'preferences.md'), content);
    const scanned = scanMarkdown(tmpDir)[0]!;
    const db = new MemoryDatabase(path.join(tmpDir, 'index', 'memora.sqlite'));
    db.upsertSource({
      id: 'legacy-source', path: scanned.absolutePath, relativePath: scanned.relativePath,
      category: scanned.category, modifiedAt: scanned.modifiedAt, size: scanned.size,
      contentHash: scanned.contentHash, indexedAt: Date.now(),
    });
    for (const chunk of chunkMarkdown(content)) db.upsertChunk({ ...chunk, id: `legacy-${chunk.chunkIndex}`, sourceId: 'legacy-source' });
    db.close();

    await service.reindex();
    const tailscale = await service.search('Tailscale');
    const concise = await service.search('concise');
    expect(tailscale).toHaveLength(1);
    expect(concise).toHaveLength(1);
    expect(tailscale[0]?.content).not.toContain('concise');
    expect(concise[0]?.content).not.toContain('Tailscale');
    expect(tailscale[0]?.heading).toBe('Preferenze');
    expect(tailscale[0]?.startLine).toBe(3);
  });

  it('dovrebbe scansionare solo file .md', async () => {
    fs.writeFileSync(path.join(tmpDir, 'memory', 'test.md'), '# Markdown\n\nContenuto.');
    fs.writeFileSync(path.join(tmpDir, 'memory', 'test.txt'), 'Non markdown.');
    fs.writeFileSync(path.join(tmpDir, 'memory', 'test.json'), '{"non": "markdown"}');

    const results = scanMarkdown(tmpDir);
    expect(results.length).toBe(1);
    expect(results[0].relativePath).toBe('memory/test.md');
  });

  it('dovrebbe gestire session reindex dopo dispose', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'memory', 'test.md'),
      '# Test\n\nContenuto.'
    );
    await service.reindex();
    await service.close();

    // Nuovo servizio su stessa directory
    service = new MemoryService(tmpDir);
    await service.initialize();
    const sources = await service.listSources();
    expect(sources.length).toBe(1);
  });

  it('recupera il dettaglio di una fonte con contenuto, titolo e chunk count', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'projects', 'vega.md'),
      '# Progetto Vega\n\n## Identità\n\n- Il colore identificativo è turchese.\n',
    );
    await service.reindex();
    const [source] = await service.listSources();
    expect(source).toMatchObject({
      relativePath: 'projects/vega.md',
      title: 'Progetto Vega',
      chunkCount: expect.any(Number),
    });
    expect(source?.chunkCount).toBeGreaterThan(0);

    const detail = await service.getSourceContent(source!.id);
    expect(detail.relativePath).toBe('projects/vega.md');
    expect(detail.content).toContain('turchese');
    expect(detail.content).toContain('## Identità');
  });

  it('modifica atomicamente una fonte, reindicizza e non tocca file adiacenti', async () => {
    const vegaPath = path.join(tmpDir, 'projects', 'vega', 'memory.md');
    const adjacentPath = path.join(tmpDir, 'projects', 'vega', 'notes.md');
    fs.mkdirSync(path.dirname(vegaPath), { recursive: true });
    fs.writeFileSync(vegaPath, '# Progetto Vega\n\n## Identità\n\n- Il colore identificativo è turchese.\n');
    fs.writeFileSync(adjacentPath, '# Note\n\nContenuto adiacente invariato.\n');
    await service.reindex();

    const sources = await service.listSources();
    const vega = sources.find((source) => source.relativePath === 'projects/vega/memory.md');
    expect(vega).toBeDefined();

    const updated = await service.updateSourceContent(
      vega!.id,
      '# Progetto Vega\n\n## Identità\n\n- Il colore identificativo è indaco.\n',
    );
    expect(updated.content).toContain('indaco');
    expect(await service.search('indaco')).toHaveLength(1);
    expect(await service.search('turchese')).toHaveLength(0);
    expect(fs.readFileSync(adjacentPath, 'utf-8')).toContain('Contenuto adiacente invariato');
    expect(fs.readdirSync(path.dirname(vegaPath)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('elimina solo il file della fonte, reindicizza e lascia intatti i file adiacenti', async () => {
    const vegaPath = path.join(tmpDir, 'projects', 'vega', 'memory.md');
    const adjacentPath = path.join(tmpDir, 'projects', 'vega', 'notes.md');
    fs.mkdirSync(path.dirname(vegaPath), { recursive: true });
    fs.writeFileSync(vegaPath, '# Progetto Vega\n\n## Identità\n\n- Il colore identificativo è turchese.\n');
    fs.writeFileSync(adjacentPath, '# Note\n\nContenuto adiacente.\n');
    await service.reindex();

    const source = (await service.listSources()).find((item) => item.relativePath === 'projects/vega/memory.md');
    expect(source).toBeDefined();
    await service.deleteSource(source!.id);

    expect(fs.existsSync(vegaPath)).toBe(false);
    expect(fs.readFileSync(adjacentPath, 'utf-8')).toContain('Contenuto adiacente');
    expect((await service.listSources()).some((item) => item.id === source!.id)).toBe(false);
    expect(await service.search('turchese')).toHaveLength(0);
  });

  it('respinge source id inesistenti e path manipolati nel database', async () => {
    await expect(service.getSourceContent('missing-source')).rejects.toMatchObject({
      code: 'source_not_found',
    });

    const outsidePath = path.join(os.tmpdir(), `memora-source-outside-${Date.now()}.md`);
    fs.writeFileSync(outsidePath, '# Fuori\n');
    const txtPath = path.join(tmpDir, 'memory', 'not-markdown.txt');
    fs.writeFileSync(txtPath, 'non markdown');
    const indexPath = path.join(tmpDir, 'index', 'memora.sqlite');
    const sessionsPath = path.join(tmpDir, 'pi-sessions', 'escape.md');
    fs.mkdirSync(path.dirname(sessionsPath), { recursive: true });
    fs.writeFileSync(sessionsPath, '# Session escape\n');

    const symlinkOutside = path.join(os.tmpdir(), `memora-source-symlink-${Date.now()}.md`);
    fs.writeFileSync(symlinkOutside, '# Symlink fuori\n');
    const symlinkPath = path.join(tmpDir, 'memory', 'symlink-escape.md');
    fs.symlinkSync(symlinkOutside, symlinkPath);

    const db = new MemoryDatabase(path.join(tmpDir, 'index', 'memora.sqlite'));
    const fake = (id: string, target: string, relativePath: string) => ({
      id,
      path: target,
      relativePath,
      category: 'memory',
      modifiedAt: Date.now(),
      size: 1,
      contentHash: id,
      indexedAt: Date.now(),
    });
    db.upsertSource(fake('outside-source', outsidePath, 'memory/outside.md'));
    db.upsertSource(fake('txt-source', txtPath, 'memory/not-markdown.txt'));
    db.upsertSource(fake('index-source', indexPath, 'index/memora.sqlite'));
    db.upsertSource(fake('sessions-source', sessionsPath, 'pi-sessions/escape.md'));
    db.upsertSource(fake('symlink-source', symlinkPath, 'memory/symlink-escape.md'));
    db.close();

    for (const id of ['outside-source', 'txt-source', 'index-source', 'sessions-source', 'symlink-source']) {
      await expect(service.getSourceContent(id)).rejects.toMatchObject({ code: 'source_forbidden' });
    }

    try {
      fs.rmSync(outsidePath, { force: true });
      fs.rmSync(symlinkOutside, { force: true });
    } catch {
      // cleanup best effort
    }
  });

  it('dovrebbe avere package.json con type:module e dist/index.d.ts dopo build', () => {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.type).toBe('module');

    const distDir = path.join(__dirname, '..', 'dist');
    const indexDts = path.join(distDir, 'index.d.ts');
    expect(fs.existsSync(indexDts)).toBe(true);
  });
});
