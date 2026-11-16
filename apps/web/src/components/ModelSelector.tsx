import React, { useCallback, useEffect, useState } from 'react';
import type { ProviderId } from '@memora/shared';
import { useModels } from '../hooks/useModels';
import { setSessionModel } from '../lib/api';

interface ModelSelectorProps {
  sessionId: string | null;
  currentModelId: string;
  provider: ProviderId;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelector({
  sessionId,
  currentModelId,
  provider,
  onModelChange,
  disabled = false,
}: ModelSelectorProps) {
  const { models, loading, error } = useModels(provider);
  const [selected, setSelected] = useState<string>(currentModelId);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    setSelected(currentModelId);
  }, [currentModelId]);

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const modelId = e.target.value;
      setSelected(modelId);
      onModelChange(modelId);

      // Se c'è una sessione attiva, tenta di cambiare modello nativamente
      if (sessionId && !disabled) {
        setChanging(true);
        try {
          await setSessionModel(sessionId, modelId, provider);
        } catch {
          // Se il cambio non è supportato, il modello si applica alla prossima sessione.
          // L'utente vede comunque la selezione come "corrente" nella UI.
        } finally {
          setChanging(false);
        }
      }
    },
    [sessionId, disabled, onModelChange, provider],
  );

  if (loading || models.length === 0) {
    return (
      <div className="model-selector is-loading">
        <span>Modello in caricamento…</span>
      </div>
    );
  }

  const freeModels = models.filter((m) => m.isFree);
  const paidModels = models.filter((m) => !m.isFree);

  return (
    <div className="model-selector">
      <label className="model-label" htmlFor="model-select">Modello</label>
      <div className="model-select-wrap">
        <select
          id="model-select"
          className="model-select"
          value={selected}
          onChange={handleChange}
          disabled={disabled || changing}
        >
          {freeModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.provider}) — {m.isRouter ? 'router gratuito' : 'gratuito'}
            </option>
          ))}
          {paidModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.provider})
            </option>
          ))}
        </select>
      </div>
      {changing && <span className="model-status">Aggiorno…</span>}
      {error && <span className="model-error">{error}</span>}
    </div>
  );
}
