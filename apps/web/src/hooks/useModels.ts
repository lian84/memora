import { useCallback, useEffect, useState } from 'react';
import type { ProviderId, ReasoningLevel } from '@memora/shared';
import { getModels, type AvailableModel } from '../lib/api';

export const MODEL_STORAGE_KEY = 'memora-selected-model';
export const MODEL_PROVIDER_STORAGE_KEY = 'memora-selected-model-provider';
export const MODEL_REASONING_STORAGE_KEY = 'memora-selected-reasoning-level';

export interface StoredModelSelection {
  modelId: string;
  provider: ProviderId;
  reasoningLevel: ReasoningLevel;
}

export function readStoredModelSelection(): StoredModelSelection | null {
  if (typeof window === 'undefined') return null;
  const modelId = localStorage.getItem(MODEL_STORAGE_KEY);
  const provider = localStorage.getItem(MODEL_PROVIDER_STORAGE_KEY);
  const reasoning = localStorage.getItem(MODEL_REASONING_STORAGE_KEY);
  if (!modelId || (provider !== 'openrouter' && provider !== 'opencode-go')) return null;
  const reasoningLevel: ReasoningLevel = reasoning === 'minimal' || reasoning === 'low' || reasoning === 'medium' || reasoning === 'high' || reasoning === 'xhigh' || reasoning === 'max' ? reasoning : 'medium';
  return { modelId, provider, reasoningLevel };
}

export function saveStoredModelSelection(selection: StoredModelSelection): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MODEL_STORAGE_KEY, selection.modelId);
  localStorage.setItem(MODEL_PROVIDER_STORAGE_KEY, selection.provider);
  localStorage.setItem(MODEL_REASONING_STORAGE_KEY, selection.reasoningLevel);
}

export function clearStoredModelSelection(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(MODEL_STORAGE_KEY);
  localStorage.removeItem(MODEL_PROVIDER_STORAGE_KEY);
  localStorage.removeItem(MODEL_REASONING_STORAGE_KEY);
}

export function useModels(provider: ProviderId) {
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getModels(provider);
      setModels(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  return { models, loading, error, load };
}
