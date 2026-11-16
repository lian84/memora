export type ProviderId = 'openrouter' | 'opencode-go';
export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const REASONING_LEVELS: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export interface ProviderSecretStatus {
  configured: boolean;
  source: 'secret-store' | 'environment' | 'none';
  editable: boolean;
}

export interface ProviderModel {
  id: string;
  name: string;
  provider: ProviderId;
  api?: string;
  contextWindow?: number;
  maxTokens?: number;
  costInput?: number;
  costOutput?: number;
  reasoning?: boolean;
  isFree: boolean;
  input?: string[];
  canonicalId?: string;
  description?: string;
  reasoningLevels?: ReasoningLevel[];
}

export interface ProviderCatalog {
  provider: ProviderId;
  models: ProviderModel[];
  cachedAt: number;
  source: 'pi' | 'remote';
  stale: boolean;
  warning?: string;
}

export interface ProviderConnectionResult {
  ok: boolean;
  httpStatus?: number;
  error?: string;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openrouter: 'OpenRouter',
  'opencode-go': 'OpenCode Go',
};
