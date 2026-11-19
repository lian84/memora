import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryService, MemoryWriter, validateMemoryTargetPath } from './index';
import type { CuratedMemory, MemoryCurator } from './index';

function writeMemoryFile(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf-8');
}

function curated(overrides: Partial<CuratedMemory> = {}): CuratedMemory {
  return {
    importance: 0.95,
    durability: 0.95,
    futureUtility: 0.95,
    novelty: 0.95,
    confidence: 0.95,
    salience: 0.95,
    memoryType: 'preference',
    action: 'new',
    entityType: 'user',
    entityName: 'utente',
    proposedText: 'Preferisco il tema scuro nell’interfaccia.',
    heading: 'Preferenze',
    category: 'preference',
    targetPath: 'memory/preferences.md',
    rationale: 'Preferenza stabile e utile in futuro.',
    relatedSourceIds: [],
    curatorProvider: 'test',
    curatorModel: 'test-model',
    latencyMs: 1,
    ...overrides,
  };
}

function fakeCurator(value: CuratedMemory | null): MemoryCurator {
  return {
    curate: async () => value,
    reportCreated: () => undefined,
    reportFailure: () => undefined,
  } as unknown as MemoryCurator;
}

describe('MemoryWriter', () => {
  let root: string;
  let memoryService: MemoryService;
  let writer: MemoryWriter;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-writer-test-'));
    fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(root, 'journal'), { recursive: true });
    fs.mkdirSync(path.join(root, 'documents'), { recursive: true });
    memoryService = new MemoryService(root);
    await memoryService.initialize();
    writer = new MemoryWriter({ dataDir: root, memoryService });
    await writer.initialize();
  });

  afterEach(async () => {
    await memoryService.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('crea un candidato esplicito senza scrivere Markdown', async () => {
    const result = await writer.processTurn({
      sessionId: 'session-1',
      userText: 'Ricorda che il progetto Orione usa come colore identificativo ametista.',
    });

    expect(result.created).toHaveLength(1);
    const candidate = result.created[0];
    expect(candidate).toMatchObject({
      sessionId: 'session-1',
      category: 'project',
      project: 'Orione',
      status: 'pending',
      origin: 'explicit',
      priority: 'high',
      targetPath: 'projects/orione/memory.md',
    });
    expect(candidate.proposedText).toContain('ametista');
    expect(fs.existsSync(path.join(root, 'projects', 'orione', 'memory.md'))).toBe(false);
    await expect(memoryService.search('ametista')).resolves.toEqual([]);
  });

  it('riconosce le principali formule esplicite anche con writer automatico disattivato', async () => {
    const texts = [
      'Salva questa informazione: il progetto Orione usa ametista.',
      'Aggiungi al second brain: il progetto Orione usa ametista.',
      'Da ora in poi preferisco usare modelli gratuiti per i test ordinari.',
      'Remember that the project Orione uses ametista.',
    ];

    for (const [index, userText] of texts.entries()) {
      const result = await writer.processTurn({ sessionId: `session-explicit-${index}`, userText });
      expect(result.created).toHaveLength(1);
      expect(result.created[0]).toMatchObject({ origin: 'explicit', priority: 'high' });
    }
  });

  it('promuove esplicitamente una risposta assistente senza Curator e con provenienza', async () => {
    const candidate = await writer.proposeAssistantMemory({
      sessionId: 'session-assistant',
      text: 'Il progetto Orione usa PostgreSQL 16 come database principale.',
      question: 'Quale database usa il progetto Orione?',
    });
    expect(candidate).toMatchObject({
      sessionId: 'session-assistant',
      sourceKind: 'assistant',
      sourceQuestion: 'Quale database usa il progetto Orione?',
      origin: 'explicit',
      status: 'pending',
    });
    expect(candidate.proposedText).toContain('PostgreSQL 16');
    expect(fs.existsSync(path.join(root, candidate.targetPath))).toBe(false);
    await expect(writer.proposeAssistantMemory({ sessionId: 'session-assistant', text: 'password=segreta' })).rejects.toMatchObject({ code: 'sensitive_content' });
  });

  it('indirizza gli eventi cronologici verso journal/YYYY-MM-DD.md', async () => {
    const fixed = Date.parse('2026-11-13T12:00:00.000Z');
    const datedWriter = new MemoryWriter({ dataDir: root, memoryService, now: () => fixed });
    await datedWriter.initialize();

    const candidate = (await datedWriter.processTurn({
      sessionId: 'session-journal',
      userText: 'Ricorda che oggi ho incontrato il team di Orione.',
    })).created[0];

    expect(candidate).toMatchObject({
      category: 'journal',
      heading: 'Note',
      targetPath: 'journal/2026-11-13.md',
    });
  });

  it('persiste i candidati e li ricarica dopo una nuova istanza', async () => {
    const created = (await writer.processTurn({
      sessionId: 'session-persist',
      userText: 'Ricorda che preferisco usare modelli gratuiti per i test ordinari.',
    })).created[0];

    const reloaded = new MemoryWriter({ dataDir: root, memoryService });
    await reloaded.initialize();
    const candidates = await reloaded.listCandidates();
    expect(candidates.map((candidate) => candidate.id)).toContain(created.id);
    expect(candidates[0]?.proposedText).toContain('modelli gratuiti');
  });

  it('approva, scrive Markdown e rende il contenuto subito recuperabile', async () => {
    const candidate = (await writer.processTurn({
      sessionId: 'session-approve',
      sourceMessageId: 'message-approve',
      sourceTimestamp: 1_759_999_000_000,
      userText: 'Ricorda che il progetto Orione usa come colore identificativo ametista.',
    })).created[0];

    const approved = await writer.approve(candidate.id);
    expect(approved.markdownChanged).toBe(true);
    expect(approved.reindexed).toBe(true);
    expect(approved.candidate.status).toBe('approved');
    expect(approved.candidate.approvedBy).toBe('user');
    expect(approved.candidate.writtenPath).toBe('projects/orione/memory.md');

    const markdown = fs.readFileSync(path.join(root, 'projects', 'orione', 'memory.md'), 'utf-8');
    expect(markdown).toContain('# Memoria progetto');
    expect(markdown).toContain('## Note progetto');
    expect(markdown).toContain('ametista');
    expect(markdown).toContain('memora-memory:v1');
    expect(markdown).toContain('"sourceSessionId":"session-approve"');
    expect(markdown).toContain('"sourceMessageId":"message-approve"');
    expect(markdown).toContain('"sourceTimestamp":1759999000000');
    expect(markdown).toContain('"status":"active"');

    const results = await memoryService.search('ametista');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.relativePath).toBe('projects/orione/memory.md');
    expect(results[0]?.content).toContain('ametista');
    expect(results[0]?.memory?.[0]).toMatchObject({
      status: 'active',
      sourceSessionId: 'session-approve',
      sourceMessageId: 'message-approve',
      project: 'Orione',
      scope: 'project:orione',
    });
  });

  it('rifiuta un candidato senza modificare il Markdown', async () => {
    const candidate = (await writer.processTurn({
      sessionId: 'session-reject',
      userText: 'Ricorda che il progetto Orione usa ametista.',
    })).created[0];

    const rejected = await writer.reject(candidate.id, 'Non serve');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectionReason).toBe('Non serve');
    expect(fs.existsSync(path.join(root, 'projects', 'orione', 'memory.md'))).toBe(false);
    expect((await writer.listCandidates('rejected')).map((item) => item.id)).toContain(candidate.id);
  });

  it('permette di modificare testo e destinazione prima dell’approvazione', async () => {
    const candidate = (await writer.processTurn({
      sessionId: 'session-edit',
      userText: 'Ricorda che il progetto Orione usa ametista.',
    })).created[0];

    const edited = await writer.updateCandidate(candidate.id, {
      proposedText: 'Il progetto Orione usa ametista come colore identificativo.',
      targetPath: 'memory/profile.md',
    });

    expect(edited.proposedText).toBe('Il progetto Orione usa ametista come colore identificativo.');
    expect(edited.targetPath).toBe('memory/profile.md');

    const approved = await writer.approve(edited.id);
    expect(approved.candidate.status).toBe('approved');
    expect(fs.readFileSync(path.join(root, 'memory', 'profile.md'), 'utf-8')).toContain('ametista');
  });

  it('valida i target e blocca path traversal, path assoluti e directory non ammesse', async () => {
    for (const target of [
      '../escape.md',
      '/tmp/absolute.md',
      'documents/not-allowed.md',
      'memory/../../escape.md',
      'memory/file.txt',
    ]) {
      await expect(validateMemoryTargetPath(root, target)).rejects.toMatchObject({
        code: 'invalid_target_path',
      });
    }

    await expect(validateMemoryTargetPath(root, 'projects/orione/memory.md')).resolves.toMatchObject({
      relativePath: 'projects/orione/memory.md',
    });

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-writer-outside-'));
    try {
      fs.symlinkSync(outside, path.join(root, 'projects', 'escape'), 'dir');
      await expect(validateMemoryTargetPath(root, 'projects/escape/memory.md')).rejects.toMatchObject({
        code: 'invalid_target_path',
      });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('blocca i possibili segreti e non li persiste nel candidate store', async () => {
    const secret = 'SuperSegreta123';
    const result = await writer.processTurn({
      sessionId: 'session-secret',
      userText: `Ricorda che la password del server è ${secret}`,
    });

    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({
      status: 'rejected',
      sensitive: true,
      proposedText: '[contenuto sensibile rimosso]',
    });
    expect(await writer.listCandidates('pending')).toEqual([]);

    const storeContent = fs.readFileSync(path.join(root, 'memory-inbox', 'candidates.jsonl'), 'utf-8');
    expect(storeContent).not.toContain(secret);
    expect(fs.existsSync(path.join(root, 'memory', 'profile.md'))).toBe(false);
  });

  it('non crea candidati automatici quando l’estrazione è disattivata', async () => {
    const result = await writer.processTurn({
      sessionId: 'session-auto-off',
      userText: 'Preferisco usare modelli gratuiti per i test ordinari.',
    });
    expect(result.created).toEqual([]);
  });

  it('crea un candidato automatico conservativo quando abilitato e ignora i saluti', async () => {
    const automaticWriter = new MemoryWriter({
      dataDir: root,
      memoryService,
      automaticExtraction: true,
    });
    await automaticWriter.initialize();

    const preference = await automaticWriter.processTurn({
      sessionId: 'session-auto',
      userText: 'Preferisco usare modelli gratuiti per i test ordinari.',
    });
    expect(preference.created).toHaveLength(1);
    expect(preference.created[0]).toMatchObject({ origin: 'automatic', priority: 'normal' });

    const greeting = await automaticWriter.processTurn({
      sessionId: 'session-auto',
      userText: 'Ciao, come va?',
    });
    expect(greeting.created).toEqual([]);
  });

  it('salva automaticamente un nuovo ricordo sopra soglia', async () => {
    const autoWriter = new MemoryWriter({
      dataDir: root,
      memoryService,
      curator: fakeCurator(curated()),
      autoApprove: { enabled: true, minConfidence: 0.9, minSalience: 0.85 },
    });
    await autoWriter.initialize();

    const result = await autoWriter.processTurn({
      sessionId: 'session-autosave',
      turnId: 'turn-autosave',
      userText: 'Preferisco il tema scuro nell’interfaccia.',
    });

    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({
      status: 'approved',
      approvedBy: 'auto',
      autoApprovalThresholds: { confidence: 0.9, salience: 0.85 },
    });
    expect(fs.readFileSync(path.join(root, 'memory', 'preferences.md'), 'utf-8')).toContain('tema scuro');
  });

  it('rispetta il default: l’auto-approvazione è disattivata', async () => {
    const disabledWriter = new MemoryWriter({
      dataDir: root,
      memoryService,
      curator: fakeCurator(curated()),
    });
    await disabledWriter.initialize();
    const result = await disabledWriter.processTurn({ sessionId: 'session-auto-disabled', userText: 'Preferisco il tema scuro.' });
    expect(result.created[0]?.status).toBe('pending');
    expect(fs.existsSync(path.join(root, 'memory', 'preferences.md'))).toBe(false);
  });

  it('lascia in revisione auto-approvazioni sotto soglia, update e PII', async () => {
    const low = new MemoryWriter({
      dataDir: root,
      memoryService,
      curator: fakeCurator(curated({ confidence: 0.5, salience: 0.9 })),
      autoApprove: { enabled: true, minConfidence: 0.9, minSalience: 0.85 },
    });
    await low.initialize();
    const lowResult = await low.processTurn({ sessionId: 'session-low', userText: 'Preferisco il tema scuro.' });
    expect(lowResult.created[0]?.status).toBe('pending');

    const update = new MemoryWriter({
      dataDir: root,
      memoryService,
      curator: fakeCurator(curated({ action: 'update', currentText: 'Preferisco il tema scuro.' })),
      autoApprove: { enabled: true },
    });
    await update.initialize();
    const updateResult = await update.processTurn({ sessionId: 'session-update', userText: 'Preferisco il tema chiaro.' });
    expect(updateResult.created[0]?.status).toBe('pending');
    expect(updateResult.created[0]?.approvedBy).toBeUndefined();

    const pii = new MemoryWriter({
      dataDir: root,
      memoryService,
      curator: fakeCurator(curated({ proposedText: 'La mia email è mario@example.com.' })),
      autoApprove: { enabled: true },
    });
    await pii.initialize();
    const piiResult = await pii.processTurn({ sessionId: 'session-pii', userText: 'Preferisco il tema scuro.' });
    expect(piiResult.created[0]?.status).toBe('pending');
    expect(fs.existsSync(path.join(root, 'memory', 'preferences.md'))).toBe(false);
  });

  it('non auto-approva un progetto diverso da quello della chat', async () => {
    const autoWriter = new MemoryWriter({
      dataDir: root,
      memoryService,
      curator: fakeCurator(curated({
        action: 'new',
        entityType: 'project',
        entityName: 'Orione',
        memoryType: 'project_fact',
        category: 'project',
        targetPath: 'projects/orione/memory.md',
      })),
      autoApprove: { enabled: true },
    });
    await autoWriter.initialize();
    const result = await autoWriter.processTurn({ sessionId: 'session-project', userText: 'Il progetto Orione usa ametista.' });
    expect(result.created[0]?.status).toBe('pending');
    expect(fs.existsSync(path.join(root, 'projects', 'orione', 'memory.md'))).toBe(false);
  });

  it('riconosce un duplicato quasi esatto', async () => {
    writeMemoryFile(
      root,
      'memory/preferences.md',
      '# Preferenze\n\n## AI workflow\n\n- Preferisce usare modelli gratuiti per i test ordinari.\n',
    );
    await memoryService.reindex();

    const candidate = (await writer.processTurn({
      sessionId: 'session-duplicate',
      userText: 'Ricorda che preferisce usare modelli gratuiti per i test ordinari.',
    })).created[0];

    expect(candidate.duplicateOf).toMatchObject({
      relativePath: 'memory/preferences.md',
      heading: 'AI workflow',
    });
    expect(candidate.status).toBe('pending');
  });

  it('segnala un possibile conflitto e mostra il contenuto esistente', async () => {
    writeMemoryFile(
      root,
      'memory/preferences.md',
      '# Preferenze\n\n## Preferenze\n\n- Preferisco il colore blu per l’interfaccia.\n',
    );
    await memoryService.reindex();

    const candidate = (await writer.processTurn({
      sessionId: 'session-conflict',
      userText: 'Ricorda che preferisco il colore ametista per l’interfaccia.',
    })).created[0];

    expect(candidate.status).toBe('conflict');
    expect(candidate.conflictsWith).toMatchObject({
      relativePath: 'memory/preferences.md',
    });
    expect(candidate.conflictsWith?.content).toContain('blu');
  });

  it('non duplica un heading già presente e salta un bullet identico', async () => {
    writeMemoryFile(
      root,
      'memory/preferences.md',
      '# Preferenze\n\n## AI workflow\n\n- Preferisco usare modelli gratuiti per i test ordinari.\n',
    );

    const first = (await writer.processTurn({
      sessionId: 'session-heading',
      userText: 'Ricorda che preferisco usare modelli gratuiti per i test ordinari.',
    })).created[0];
    await writer.approve(first.id);

    const second = (await writer.processTurn({
      sessionId: 'session-heading',
      userText: 'Ricorda che preferisco usare modelli gratuiti per i test ordinari.',
    })).created[0];
    const secondApproved = await writer.approve(second.id);

    const markdown = fs.readFileSync(path.join(root, 'memory', 'preferences.md'), 'utf-8');
    expect(markdown.match(/## AI workflow/g)).toHaveLength(1);
    expect(markdown.match(/modelli gratuiti per i test ordinari/g)).toHaveLength(1);
    expect(secondApproved.markdownChanged).toBe(false);
    expect(secondApproved.candidate.skippedDuplicate).toBe(true);
  });
});

describe('MemoryWriter lifecycle', () => {
  let root: string;
  let memoryService: MemoryService;
  let writer: MemoryWriter;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-writer-lifecycle-'));
    memoryService = new MemoryService(root);
    await memoryService.initialize();
    writer = new MemoryWriter({ dataDir: root, memoryService });
    await writer.initialize();
  });

  afterEach(async () => {
    await memoryService.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('marca i candidati pendenti come rimossi quando la fonte viene cancellata', async () => {
    const candidate = (await writer.processTurn({
      sessionId: 'session-purge',
      userText: 'Ricorda che il progetto Orione usa ametista.',
    })).created[0];
    expect(candidate.status).toBe('pending');

    expect(await writer.markCandidatesPurgedForPath(candidate.targetPath)).toBe(1);
    const [purged] = await writer.listCandidates();
    expect(purged).toMatchObject({
      id: candidate.id,
      status: 'rejected',
      rejectionReason: 'source_deleted',
      purgeReason: 'source_deleted',
    });
    expect(purged?.purgedAt).toBeTypeOf('number');
    expect(await writer.listCandidates('pending')).toEqual([]);
  });
});

describe('MemoryWriter idempotency', () => {
  let root: string;
  let memoryService: MemoryService;
  let writer: MemoryWriter;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-writer-idempotency-'));
    memoryService = new MemoryService(root);
    await memoryService.initialize();
    writer = new MemoryWriter({ dataDir: root, memoryService });
    await writer.initialize();
  });

  afterEach(async () => {
    await memoryService.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('non crea due candidati per lo stesso turnId', async () => {
    const input = {
      sessionId: 'session-idempotent',
      turnId: 'turn-idempotent',
      sourceMessageId: 'message-idempotent',
      userText: 'Ricorda che il progetto Orione usa ametista.',
    };
    const first = await writer.processTurn(input);
    const second = await writer.processTurn(input);
    expect(first.created).toHaveLength(1);
    expect(second.created).toEqual([]);
    expect(await writer.listCandidates()).toHaveLength(1);
  });
});
