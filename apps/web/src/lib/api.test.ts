import { afterEach, expect, test, vi } from 'vitest';
import {
  approveMemoryCandidate,
  createSession,
  deleteMemorySource,
  deleteSession,
  getAdminSettings,
  getAdminStatus,
  getModels,
  getProviderCatalog,
  getProviderSecrets,
  getMemorySource,
  getMemorySourceHistory,
  isSessionNotFoundError,
  listMemoryCandidates,
  listSessions,
  parseSSEEventData,
  rejectMemoryCandidate,
  updateMemoryCandidate,
  saveProviderSecret,
  searchMemoryHistory,
  testProviderConnection,
  setSessionReasoningLevel,
  updateAdminSettings,
  updateMemorySource,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('mantiene separato il payload reale dall’envelope SSE', () => {
  const event = parseSSEEventData(
    JSON.stringify({
      type: 'message_update',
      sessionId: 'session-1',
      timestamp: 123,
      payload: {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'Ciao',
        },
      },
    }),
    'fallback-session',
  );

  expect(event).toEqual({
    type: 'message_update',
    sessionId: 'session-1',
    timestamp: 123,
    payload: {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Ciao',
      },
    },
  });
});

test('memory_sources resta un payload separato dal testo assistant', () => {
  const event = parseSSEEventData(
    JSON.stringify({
      type: 'memory_sources',
      sessionId: 'session-1',
      timestamp: 123,
      payload: [{ relativePath: 'projects/example.md' }],
    }),
    'fallback-session',
  );

  expect(event?.type).toBe('memory_sources');
  expect(event?.payload).toEqual([{ relativePath: 'projects/example.md' }]);
});

test('listSessions usa /api/sessions per le attive e archived=true solo per le archiviate', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await listSessions();
  await listSessions(true);

  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions');
  expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/sessions?archived=true');

  for (const call of fetchMock.mock.calls) {
    const init = call[1] as RequestInit;
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  }
});

test('createSession invia un body JSON e quindi imposta il content-type', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ sessionId: 'new-session' }), { status: 201 }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await createSession('openrouter/auto');

  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  expect(init.body).toBe(JSON.stringify({ modelId: 'openrouter/auto' }));
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
});

test('deleteSession invia DELETE con l ID corretto e valida il body di successo', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ sessionId: 'session-123', deleted: true }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(deleteSession('session-123')).resolves.toEqual({ sessionId: 'session-123', deleted: true });
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/sessions/session-123',
    expect.objectContaining({ method: 'DELETE' }),
  );

  // Regressione: un DELETE senza body non deve dichiarare application/json,
  // altrimenti Fastify risponde 400 FST_ERR_CTP_EMPTY_JSON_BODY.
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  expect(init.body).toBeUndefined();
  expect(new Headers(init.headers).has('Content-Type')).toBe(false);
});

test('mostra il messaggio Fastify specifico quando il body JSON è vuoto', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        statusCode: 400,
        code: 'FST_ERR_CTP_EMPTY_JSON_BODY',
        error: 'Bad Request',
        message: "Body cannot be empty when content-type is set to 'application/json'",
      }),
      { status: 400 },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(deleteSession('session-123')).rejects.toThrow(/Body cannot be empty/);
});

test('le API Memory Inbox usano URL, metodi e body coerenti', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ candidate: { id: 'candidate-1' } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      candidate: { id: 'candidate-1' },
      reindexed: true,
      markdownChanged: true,
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ candidate: { id: 'candidate-1' } }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await listMemoryCandidates('pending');
  await updateMemoryCandidate('candidate-1', { proposedText: 'Testo aggiornato' });
  await approveMemoryCandidate('candidate-1');
  await rejectMemoryCandidate('candidate-1', 'Non serve');

  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/memory/candidates?status=pending');
  expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/memory/candidates/candidate-1');
  expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({ proposedText: 'Testo aggiornato' }),
  }));
  expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/memory/candidates/candidate-1/approve');
  expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
  expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/memory/candidates/candidate-1/reject');
  expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ reason: 'Non serve' }),
  }));
});

test('le API fonte usano solo source id e metodi REST coerenti', async () => {
  const source = {
    id: 'source-1',
    path: '/tmp/data/projects/vega/memory.md',
    relativePath: 'projects/vega/memory.md',
    category: 'projects',
    modifiedAt: 1,
    size: 10,
    contentHash: 'hash',
    indexedAt: 1,
    chunkCount: 1,
    title: 'Progetto Vega',
    content: '# Progetto Vega',
  };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ source }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ source }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      sourceId: 'source-1',
      relativePath: 'projects/vega/memory.md',
      deleted: true,
    }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await getMemorySource('source-1');
  await updateMemorySource('source-1', '# Progetto Vega\n\nIndaco');
  await deleteMemorySource('source-1');

  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/memory/sources/source-1');
  expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/memory/sources/source-1');
  expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({ content: '# Progetto Vega\n\nIndaco' }),
  }));
  expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/memory/sources/source-1');
  expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
  expect(new Headers((fetchMock.mock.calls[2]?.[1] as RequestInit).headers).has('Content-Type')).toBe(false);
});

test('deleteSession espone un errore leggibile per un 404 controllato', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: 'session_not_found' }), { status: 404 }),
  );
  vi.stubGlobal('fetch', fetchMock);

  let caught: unknown;
  try { await deleteSession('missing-session'); } catch (error) { caught = error; }
  expect(isSessionNotFoundError(caught)).toBe(true);
  expect((caught as Error).message).toBe('404: session not found');
});


test('le API admin usano il prefisso centralizzato e inviano solo il patch', async () => {
  const payload = { memory: { searchMode: 'semantic' } } as const;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 1, settings: {} }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 1, settings: {}, changed: [], appliedLive: [], restartRequired: [] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ memory: {} }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await getAdminSettings();
  await updateAdminSettings(payload);
  await getAdminStatus();

  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
    '/api/admin/settings',
    '/api/admin/settings',
    '/api/admin/status',
  ]);
  expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify(payload) }));
});


test('le API provider usano percorsi admin e non espongono chiavi nelle risposte', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ openrouter: { configured: true, source: 'secret-store', editable: true } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ provider: 'opencode-go', configured: true, source: 'secret-store', editable: true, restartRequired: [] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ provider: 'opencode-go', models: [], cachedAt: 1, source: 'remote', stale: false }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, httpStatus: 200 }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await getProviderSecrets();
  await saveProviderSecret('opencode-go', 'candidate-secret');
  await getProviderCatalog('opencode-go', true);
  await testProviderConnection('opencode-go', 'candidate-secret');

  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
    '/api/admin/secrets',
    '/api/admin/providers/opencode-go/secret',
    '/api/admin/providers/opencode-go/models?refresh=true',
    '/api/admin/providers/opencode-go/test',
  ]);
  expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: 'PUT', body: JSON.stringify({ apiKey: 'candidate-secret' }) }));
  expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify({ apiKey: 'candidate-secret' }) }));
});


test('getModels limita il catalogo al provider selezionato', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  await getModels('opencode-go');
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/models?provider=opencode-go');
});


test('aggiorna il livello reasoning tramite endpoint dedicato', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessionId: 's', reasoningLevel: 'high' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(setSessionReasoningLevel('s', 'high')).resolves.toEqual({ sessionId: 's', reasoningLevel: 'high' });
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/s/reasoning');
  expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ reasoningLevel: 'high' }) }));
});


test('le API storico usano source id, query e path encoded', async () => {
  const records = [{ versionId: 'ver_1', status: 'superseded' }];
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ records }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ records }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await getMemorySourceHistory('source-1');
  await searchMemoryHistory('database prima?', 'projects/vega/memory.md');
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/memory/sources/source-1/history');
  expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/memory/history?q=database%20prima%3F&path=projects%2Fvega%2Fmemory.md');
});
