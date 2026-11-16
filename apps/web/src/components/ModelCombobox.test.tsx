import { expect, test } from 'vitest';
import type { ProviderModel } from '@memora/shared';
import { filterModels } from './ModelCombobox';
import { switchProvider, validateModelSelections } from './AdminSettings';
import type { RuntimeSettings } from '@memora/shared';

const models: ProviderModel[] = [
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', provider: 'opencode-go', isFree: false, contextWindow: 1_000_000, reasoning: true },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'opencode-go', isFree: false },
  { id: 'openrouter/free', name: 'OpenRouter Free', provider: 'openrouter', isFree: true },
  { id: 'Qwen/Qwen3-Flash', name: 'Qwen3 Flash', provider: 'openrouter', isFree: false },
];

test('cerca per nome modello senza distinzione di maiuscole', () => {
  expect(filterModels(models, 'DEEPSEEK').map(model => model.id)).toEqual(['deepseek-v4.1-flash', 'deepseek-v4-pro']);
  expect(filterModels(models, 'flash').map(model => model.id)).toContain('Qwen/Qwen3-Flash');
});

test('cerca per model id parziale e provider', () => {
  expect(filterModels(models, 'v4.1').map(model => model.id)).toEqual(['deepseek-v4.1-flash']);
  expect(filterModels(models, 'opencode-go')).toHaveLength(2);
});

test('restituisce nessun risultato e rispetta il filtro Free', () => {
  expect(filterModels(models, 'non-esiste')).toEqual([]);
  expect(filterModels(models, '', true).map(model => model.id)).toEqual(['openrouter/free']);
});

test('impedisce un model/provider mismatch prima del salvataggio', () => {
  const draft: RuntimeSettings = {
    memory: { searchMode: 'lexical', topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 },
    embeddings: { enabled: false, model: 'Owner/model' },
    curator: { enabled: false, auto: true, provider: 'openrouter', model: '', reasoningLevel: 'low', minConfidence: 0.75, minSalience: 0.7 },
    chat: { provider: 'opencode-go', defaultModel: 'deepseek-v4.1-flash', reasoningLevel: 'medium' },
  };
  const catalogs = {
    'opencode-go': { provider: 'opencode-go' as const, models: models.filter(model => model.provider === 'opencode-go'), cachedAt: 1, source: 'remote' as const, stale: false },
  };
  expect(validateModelSelections(draft, catalogs)).toBeNull();
  expect(validateModelSelections({ ...draft, chat: { ...draft.chat, defaultModel: 'model-of-another-provider' } }, catalogs)).toContain('provider');
});


test('il cambio provider azzera il modello precedente senza toccare l’altro ruolo', () => {
  const draft: RuntimeSettings = {
    memory: { searchMode: 'lexical', topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 },
    embeddings: { enabled: false, model: 'Owner/model' },
    curator: { enabled: true, auto: true, provider: 'openrouter', model: 'openrouter/free', reasoningLevel: 'low', minConfidence: 0.75, minSalience: 0.7 },
    chat: { provider: 'openrouter', defaultModel: 'openrouter/free', reasoningLevel: 'medium' },
  };
  const chat = switchProvider(draft, 'chat', 'opencode-go');
  expect(chat.chat).toEqual({ provider: 'opencode-go', defaultModel: '', reasoningLevel: 'medium' });
  expect(chat.curator).toEqual(draft.curator);
  const curator = switchProvider(draft, 'curator', 'opencode-go');
  expect(curator.curator).toMatchObject({ provider: 'opencode-go', model: '' });
  expect(curator.chat).toEqual(draft.chat);
});
