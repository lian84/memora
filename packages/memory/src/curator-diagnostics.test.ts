import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCurator, OpenCodeGoCuratorProvider, OpenRouterCuratorProvider, type CuratorInput } from './curator.js';
import type { CuratorDiagnostic } from './curator.js';

const input = { sessionId: 's', userText: 'private-message-not-for-logs' };
const valid = { shouldRemember: true, ephemeral: false, importance: 0.9, durability: 0.9, futureUtility: 0.9, novelty: 0.9, confidence: 0.9, memoryType: 'preference', action: 'new', entity: { type: 'user', name: '' }, target: { heading: 'Note' }, proposedText: 'Preferisce un servizio.', rationale: 'È stabile.' };
const response = (content: string, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
const memory = { search: async () => [] };
function create(timeout = 100) {
  const logs: CuratorDiagnostic[] = [];
  const provider = new OpenRouterCuratorProvider('nvidia/model:free', 'test-secret-value', timeout);
  const curator = new MemoryCurator(provider, memory, { log: event => logs.push(event) });
  return { curator, logs };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('safe curator diagnostics', () => {
  it('reports request, response, parse and validation without content or credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(JSON.stringify(valid))));
    const { curator, logs } = create();
    const result = await curator.curate(input, false);
    expect(result).not.toBeNull();
    expect(logs.map(e => e.event)).toEqual(['curator_invoked', 'curator_request', 'curator_response', 'curator_response_metadata', 'curator_json_valid', 'curator_validation_passed']);
    expect(logs.find(e => e.event === 'curator_json_valid')).toMatchObject({ stage: 'parse', httpStatus: 200, jsonValid: true, provider: 'openrouter', model: 'nvidia/model:free' });
    expect(logs.at(-1)).toMatchObject({ stage: 'validation', validationPassed: true, httpStatus: 200 });
    const serialized = JSON.stringify(logs);
    for (const forbidden of ['private-message-not-for-logs', 'test-secret-value', valid.proposedText, valid.rationale]) expect(serialized).not.toContain(forbidden);
  });

  it('distinguishes HTTP errors without logging the response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider-secret-message', { status: 429 })));
    const { curator, logs } = create();
    await expect(curator.curate(input, false)).rejects.toThrow('Memory curator failed');
    expect(logs.at(-1)).toMatchObject({ event: 'curator_provider_failure', stage: 'response', httpStatus: 429, errorCode: 'http_error' });
    expect(JSON.stringify(logs)).not.toContain('provider-secret-message');
  });

  it('distinguishes malformed model JSON from schema validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('{bad json')));
    const first = create(); await expect(first.curator.curate(input, false)).rejects.toThrow();
    expect(first.logs.at(-1)).toMatchObject({ event: 'curator_invalid_json', stage: 'parse', httpStatus: 200, jsonValid: false, errorCode: 'invalid_content_json' });
    vi.stubGlobal('fetch', vi.fn(async () => response(JSON.stringify({ ...valid, confidence: 4 }))));
    const second = create(); await expect(second.curator.curate(input, false)).rejects.toThrow();
    expect(second.logs.at(-1)).toMatchObject({ event: 'curator_validation_failure', stage: 'validation', httpStatus: 200, validationPassed: false, errorCode: 'invalid_score' });
  });

  it('reports reasoning exhausting the response budget without logging content', async () => {
    const body = { choices: [{ message: { content: null }, finish_reason: 'length' }], usage: { completion_tokens: 700, completion_tokens_details: { reasoning_tokens: 700 } } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const { curator, logs } = create();
    await expect(curator.curate(input, false)).rejects.toThrow();
    expect(logs.find(e => e.event === 'curator_response_metadata')).toMatchObject({ finishReason: 'length', contentState: 'null', outputTokens: 700, reasoningTokens: 700 });
    expect(logs.at(-1)).toMatchObject({ event: 'curator_invalid_json', errorCode: 'empty_content_token_limit' });
  });

  it('reports decision threshold and duplicate separately', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(JSON.stringify({ ...valid, confidence: 0.5 }))));
    const first = create(); expect(await first.curator.curate(input, false)).toBeNull();
    expect(first.logs.at(-1)).toMatchObject({ event: 'curator_below_threshold', stage: 'decision', httpStatus: 200, errorCode: 'confidence_low' });
    vi.stubGlobal('fetch', vi.fn(async () => response(JSON.stringify({ ...valid, action: 'duplicate' }))));
    const second = create(); expect(await second.curator.curate(input, false)).toBeNull();
    expect(second.logs.at(-1)).toMatchObject({ event: 'curator_duplicate', stage: 'decision', httpStatus: 200 });
  });

  it('applies separate configurable salience and confidence thresholds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(JSON.stringify({ ...valid, importance: 0.5, durability: 0.5, futureUtility: 0.5, novelty: 0.5, confidence: 0.9 }))));
    const logs: CuratorDiagnostic[] = [];
    const curator = new MemoryCurator(new OpenRouterCuratorProvider('nvidia/model:free', 'test-secret-value'), memory, { minConfidence: 0.75, minSalience: 0.70, log: event => logs.push(event) });
    expect(await curator.curate(input, false)).toBeNull();
    expect(logs.at(-1)).toMatchObject({ event: 'curator_below_threshold', errorCode: 'salience_low', confidenceThreshold: 0.75, salienceThreshold: 0.70 });
  });

  it('reports a timeout distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('private error')));
    })));
    const { curator, logs } = create(10);
    await expect(curator.curate(input, false)).rejects.toThrow();
    expect(logs.at(-1)).toMatchObject({ event: 'curator_timeout', stage: 'request', errorCode: 'request_timeout' });
    expect(JSON.stringify(logs)).not.toContain('private error');
  });

  it('reports a missing model without disclosing the key', async () => {
    const logs: CuratorDiagnostic[] = [];
    const curator = new MemoryCurator(new OpenRouterCuratorProvider('', 'test-secret-value'), memory, { log: event => logs.push(event) });
    await expect(curator.curate(input, false)).rejects.toThrow();
    expect(logs.at(-1)).toMatchObject({ event: 'curator_provider_failure', stage: 'request', errorCode: 'missing_model_or_credentials' });
    expect(JSON.stringify(logs)).not.toContain('test-secret-value');
  });
});

// Compile-time check that providers cannot receive arbitrary chat/session state.
const _input: CuratorInput = { userText: '', recentUserMessages: [], existingMemory: [], existingBullets: [], explicit: false };
void _input;


describe('OpenCode Go curator provider', () => {
  it('uses the OpenAI-compatible Go endpoint and reports the real provider', async () => {
    const fetchMock = vi.fn(async () => response(JSON.stringify(valid)));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenCodeGoCuratorProvider('deepseek-v4.1-flash', 'go-secret-value', 'high');
    const logs: CuratorDiagnostic[] = [];
    const curator = new MemoryCurator(provider, memory, { log: event => logs.push(event) });
    await expect(curator.curate(input, false)).resolves.not.toBeNull();
    const request = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[0]).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions');
    expect(request[1].headers).toMatchObject({ Authorization: 'Bearer go-secret-value' });
    expect((request[1].headers as Record<string, string>)['x-opencode-session']).toBeTruthy();
    const body = JSON.parse(request[1].body as string);
    expect(body).not.toHaveProperty('reasoning');
    expect(body).toHaveProperty('response_format');
    expect(body.max_tokens).toBe(2500);
    expect(body.reasoning_effort).toBe('high');
    expect(logs[0]).toMatchObject({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' });
    expect(JSON.stringify(logs)).not.toContain('go-secret-value');
  });
});
