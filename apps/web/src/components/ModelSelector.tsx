import React, { useCallback, useEffect, useState } from 'react';
import type { ProviderId } from '@memora/shared';
import { useModels } from '../hooks/useModels';
import { setSessionModel } from '../lib/api';
import { useI18n } from '../i18n';

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
  const { t } = useI18n();
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
      <div className="admin-label chat-model-field is-loading">
        <span>{t('Modello')}</span>
        <span className="model-status">{t('Caricamento…')}</span>
      </div>
    );
  }

  const freeModels = models.filter((m) => m.isFree);
  const paidModels = models.filter((m) => !m.isFree);

  return (
    <label className="admin-label chat-model-field" htmlFor="model-select">
      <span>{t('Modello')}</span>
      <select
        id="model-select"
        className="model-select"
        value={selected}
        onChange={handleChange}
        disabled={disabled || changing}
      >
          {freeModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.provider}) — {t(m.isRouter ? 'router gratuito' : 'gratuito')}
            </option>
          ))}
          {paidModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.provider})
            </option>
          ))}
      </select>
      {changing && <small className="model-status">{t('Aggiorno…')}</small>}
      {error && <small className="model-error">{error}</small>}
    </label>
  );
}
