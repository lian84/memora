import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderId, ProviderModel } from '@memora/shared';
import { useI18n } from '../i18n';

export function filterModels(models: ProviderModel[], query: string, freeOnly = false): ProviderModel[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return models.filter(model => {
    if (freeOnly && !model.isFree) return false;
    if (terms.length === 0) return true;
    const haystack = [model.name, model.id, model.provider, model.api, model.canonicalId]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}

function formatContext(context?: number): string | null {
  if (!context) return null;
  if (context >= 1_000_000) return `${(context / 1_000_000).toFixed(context % 1_000_000 === 0 ? 0 : 1)}M ctx`;
  if (context >= 1_000) return `${Math.round(context / 1_000)}k ctx`;
  return `${context} ctx`;
}

function modelMeta(model: ProviderModel): string[] {
  const meta: string[] = [];
  const context = formatContext(model.contextWindow);
  if (context) meta.push(context);
  if (model.isFree) meta.push('Free');
  else if (typeof model.costInput === 'number' || typeof model.costOutput === 'number') {
    meta.push(`$${model.costInput ?? 0}/$${model.costOutput ?? 0} per M`);
  }
  if (model.reasoning) meta.push('reasoning');
  if (model.input?.includes('image')) meta.push('vision');
  return meta;
}

interface ModelComboboxProps {
  models: ProviderModel[];
  provider: ProviderId;
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  loading?: boolean;
  onRefresh?: () => void;
}

export function ModelCombobox({ models, provider, value, onChange, disabled = false, loading = false, onRefresh }: ModelComboboxProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const blurTimer = useRef<number | null>(null);
  const selected = models.find(model => model.id === value);
  const filtered = useMemo(() => filterModels(models, query, freeOnly), [models, query, freeOnly]);

  useEffect(() => { setActiveIndex(0); }, [query, freeOnly, models]);
  useEffect(() => () => { if (blurTimer.current !== null) window.clearTimeout(blurTimer.current); }, []);

  const choose = (model: ProviderModel) => {
    onChange(model.id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className={`model-combobox${open ? ' is-open' : ''}`}>
      <div className="model-combobox-row">
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={`model-list-${provider}`}
          aria-autocomplete="list"
          placeholder={selected ? `${selected.name} — ${selected.id}` : t('🔎 Cerca modello per nome o id…')}
          value={query}
          disabled={disabled}
          onFocus={() => {
            if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
            setOpen(true);
          }}
          onBlur={() => { blurTimer.current = window.setTimeout(() => setOpen(false), 120); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex(index => Math.min(index + 1, filtered.length - 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => Math.max(index - 1, 0)); }
            else if (event.key === 'Enter' && open && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]!); }
            else if (event.key === 'Escape') { setOpen(false); setQuery(''); }
          }}
        />
        {onRefresh && <button type="button" className="model-refresh" onClick={onRefresh} disabled={disabled || loading}>{loading ? t('Aggiorno…') : t('Aggiorna elenco')}</button>}
      </div>
      {provider === 'openrouter' && (
        <label className="model-free-filter">
          <input type="checkbox" checked={freeOnly} disabled={disabled} onChange={(event) => setFreeOnly(event.target.checked)} />
          {t('Solo Free')}
        </label>
      )}
      {selected && !open && (
        <div className="model-selected">
          <strong>{selected.name}</strong>
          <code>{selected.id}</code>
          {modelMeta(selected).map(meta => <span key={meta}>{meta}</span>)}
        </div>
      )}
      {open && (
        <div className="model-combobox-popover">
          <div className="model-result-count">
            {loading ? t('Caricamento modelli…') : query || freeOnly ? t('{count} modelli trovati', { count: filtered.length }) : t('{count} modelli disponibili', { count: models.length })}
          </div>
          {!loading && filtered.length === 0 && <div className="model-no-results">{t('Nessun modello corrispondente')}</div>}
          {!loading && filtered.length > 0 && (
            <ul id={`model-list-${provider}`} role="listbox" className="model-result-list">
              {filtered.map((model, index) => (
                <li key={model.id} role="option" aria-selected={model.id === value}>
                  <button
                    type="button"
                    className={`${index === activeIndex ? 'is-active' : ''}${model.id === value ? ' is-selected' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(model)}
                  >
                    <span className="model-result-main">
                      <strong>{model.name}</strong>
                      <code>{model.id}</code>
                    </span>
                    {modelMeta(model).length > 0 && <span className="model-result-meta">{modelMeta(model).join(' · ')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
