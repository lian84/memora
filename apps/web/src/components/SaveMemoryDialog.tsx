import { useEffect, useState } from 'react';
import type { AssistantMemoryProposal, MemoryCandidate, ProjectRecord } from '@memora/shared';
import { extractMemoryProposals, saveResponseAsMemory, searchMemory } from '../lib/api';
import { useI18n } from '../i18n';

interface SaveMemoryDialogProps {
  sessionId: string;
  content: string;
  question?: string;
  context?: string[];
  sourceMessageId?: string;
  sourceTimestamp?: number;
  projects: ProjectRecord[];
  defaultProjectId?: string | null;
  onClose: () => void;
  onSaved: (candidates: MemoryCandidate[]) => void;
}

interface EditableProposal extends AssistantMemoryProposal {
  key: string;
  text: string;
  enabled: boolean;
}

interface RelatedMemory {
  sourceId: string;
  relativePath: string;
  heading: string | null;
  content: string;
}

function fallbackProposal(content: string, t: (source: string) => string): EditableProposal {
  return {
    key: 'original',
    text: content,
    proposedText: content,
    category: 'fact',
    heading: t('Fatti'),
    action: 'new',
    rationale: t('Testo originale della risposta, senza estrazione automatica.'),
    enabled: true,
  };
}

export function SaveMemoryDialog({
  sessionId,
  content,
  question,
  context = [],
  sourceMessageId,
  sourceTimestamp,
  projects,
  defaultProjectId,
  onClose,
  onSaved,
}: SaveMemoryDialogProps) {
  const { t } = useI18n();
  const [scope, setScope] = useState(defaultProjectId ?? 'global');
  const [items, setItems] = useState<EditableProposal[]>([]);
  const [extracting, setExtracting] = useState(true);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [related, setRelated] = useState<RelatedMemory[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setExtracting(true);
    setExtractError(null);
    setItems([]);
    void extractMemoryProposals(sessionId, content, { question, context, projectId: scope === 'global' ? null : scope })
      .then(result => {
        if (cancelled) return;
        if (result.proposals === null) {
          setItems([fallbackProposal(content, t)]);
          setExtractError(result.warning === 'curator_unavailable' ? t('Curator temporaneamente non disponibile: uso il testo originale, modificabile.') : t('Estrazione non disponibile: uso il testo originale, modificabile.'));
        } else {
          setItems(result.proposals.map((proposal, index) => ({
            ...proposal,
            key: `${index}-${proposal.proposedText.slice(0, 24)}`,
            text: proposal.proposedText,
            enabled: true,
          })));
        }
      })
      .catch(err => {
        if (cancelled) return;
        setItems([fallbackProposal(content, t)]);
        setExtractError(t('Estrazione non riuscita: {error}. Puoi correggere il testo originale.', { error: err instanceof Error ? err.message : String(err) }));
      })
      .finally(() => { if (!cancelled) setExtracting(false); });
    return () => { cancelled = true; };
  }, [sessionId, content, question, t]);

  useEffect(() => {
    const query = [question, ...items.filter(item => item.enabled).map(item => item.text)].filter(Boolean).join(' ').trim();
    if (!query) { setRelated([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingRelated(true);
      void searchMemory(query, { topK: 5, maxChars: 1500, ...(scope !== 'global' ? { projectId: scope } : {}) })
        .then(results => { if (!cancelled) setRelated(results); })
        .catch(() => { if (!cancelled) setRelated([]); })
        .finally(() => { if (!cancelled) setLoadingRelated(false); });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [question, items, scope]);

  const updateItem = (key: string, patch: Partial<EditableProposal>) => {
    setItems(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  };

  const save = async () => {
    const selected = items.filter(item => item.enabled && item.text.trim());
    if (selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const candidates: MemoryCandidate[] = [];
      for (const item of selected) {
        candidates.push(await saveResponseAsMemory(sessionId, item.text.trim(), {
          sourceMessageId,
          sourceTimestamp,
          question,
          context,
          projectId: scope === 'global' ? null : scope,
          category: item.category,
          heading: item.heading,
          action: item.action,
          currentText: item.currentText,
        }));
      }
      onSaved(candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = items.filter(item => item.enabled && item.text.trim()).length;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => { if (!saving) onClose(); }}>
      <div className="memory-save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-memory-title" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <span className="admin-eyebrow">Memory Inbox</span>
            <h2 id="save-memory-title">{t('Salva come memoria')}</h2>
          </div>
          <button type="button" className="project-files-icon" onClick={onClose} disabled={saving} aria-label={t('Chiudi')}>×</button>
        </header>

        {question && (
          <div className="memory-save-context">
            <span>{t('Domanda collegata')}</span>
            <p>{question}</p>
            {context.length > 0 && <details><summary>{t('Contesto recente ({count})', { count: context.length })}</summary>{context.map((item, index) => <p key={index}>{item}</p>)}</details>}
          </div>
        )}

        <div className="memory-save-extraction-status">
          {extracting ? t('Il Curator sta analizzando risposta, contesto e memoria esistente…') : extractError ?? (items.length === 1 ? t('1 fatto proposto dal Curator.') : t('{count} fatti proposti dal Curator.', { count: items.length }))}
        </div>

        {!extracting && items.length === 0 && (
          <div className="memory-save-empty">
            {t('Nessun fatto durevole individuato.')}
            <button type="button" onClick={() => setItems([fallbackProposal(content, t)])}>{t('Usa il testo originale')}</button>
          </div>
        )}

        <div className="memory-save-proposals">
          {items.map(item => (
            <article className={`memory-save-proposal${item.enabled ? '' : ' is-disabled'}`} key={item.key}>
              <label className="memory-save-proposal-head">
                <input type="checkbox" checked={item.enabled} onChange={event => updateItem(item.key, { enabled: event.target.checked })} disabled={saving} />
                <strong>{item.category}</strong>
                <span>{item.action === 'update' ? t('aggiornamento') : t('nuovo fatto')}</span>
              </label>
              <textarea value={item.text} onChange={event => updateItem(item.key, { text: event.target.value })} rows={4} disabled={saving || !item.enabled} />
              {item.currentText && <div className="memory-save-current"><span>{t('Memoria attuale')}</span><p>{item.currentText}</p></div>}
              {item.rationale && <p className="memory-save-rationale">{item.rationale}</p>}
            </article>
          ))}
        </div>

        <label className="memory-save-field">{t('Dove salvarla')}
          <select value={scope} onChange={event => setScope(event.target.value)} disabled={saving || extracting}>
            <option value="global">{t('Globale — tutte le chat')}</option>
            {projects.map(project => <option key={project.id} value={project.id}>{t('Progetto:')} {project.name}</option>)}
          </select>
        </label>

        <div className="memory-save-related">
          <div className="memory-save-related-title">{t('Memorie correlate')} {loadingRelated ? t('· cerco…') : related.length > 0 ? `(${related.length})` : ''}</div>
          {related.length === 0 && !loadingRelated && <div className="memory-save-related-empty">{t('Nessuna memoria correlata trovata.')}</div>}
          {related.map(memory => (
            <div className="memory-save-related-item" key={`${memory.sourceId}-${memory.relativePath}-${memory.heading ?? ''}`}>
              <strong>{memory.relativePath}{memory.heading ? ` · ${memory.heading}` : ''}</strong>
              <p>{memory.content.slice(0, 260)}{memory.content.length > 260 ? '…' : ''}</p>
            </div>
          ))}
        </div>

        {error && <div className="memory-save-error" role="alert">{error}</div>}

        <footer>
          <button type="button" onClick={onClose} disabled={saving}>{t('Annulla')}</button>
          <button type="button" className="is-primary" onClick={() => void save()} disabled={saving || extracting || enabledCount === 0}>
            {saving ? t('Salvo…') : enabledCount > 1 ? t('Metti in Memory Inbox ({count})', { count: enabledCount }) : t('Metti in Memory Inbox')}
          </button>
        </footer>
      </div>
    </div>
  );
}
