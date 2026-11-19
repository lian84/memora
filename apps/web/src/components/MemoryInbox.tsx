import { useCallback, useEffect, useState } from 'react';
import {
  approveMemoryCandidate,
  listMemoryCandidates,
  rejectMemoryCandidate,
  updateMemoryCandidate,
} from '../lib/api';
import { PROVIDER_LABELS, type MemoryCandidate } from '@memora/shared';
import { useI18n } from '../i18n';

interface MemoryInboxProps {
  refreshKey?: number;
  projectId?: string | null;
  onChanged?: () => void;
  onCountChange?: (count: number) => void;
}

const categoryLabels: Record<string, string> = {
  preference: 'Preferenza',
  decision: 'Decisione',
  profile: 'Profilo',
  project: 'Progetto',
  goal: 'Obiettivo',
  workflow: 'Workflow',
  fact: 'Fatto',
};

function shortReference(value: string): string {
  return value.length > 18 ? `${value.slice(0, 15)}…` : value;
}

function formatTimestamp(value: number | undefined, language: string): string | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return new Date(value).toLocaleString(language === 'it' ? 'it-IT' : language === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

export function MemoryCandidateProvenance({ candidate }: { candidate: MemoryCandidate }) {
  const { t, language } = useI18n();
  const createdAt = formatTimestamp(candidate.createdAt, language);
  const sourceAt = formatTimestamp(candidate.sourceTimestamp, language);
  return (
    <div className="memory-candidate-provenance">
      <span>{t('Stato:')} <strong>{candidate.status}</strong></span>
      <span>{t('Origine:')} <strong>{t(candidate.sourceKind === 'assistant' ? 'risposta assistente' : 'utente')}</strong></span>
      {candidate.sourceQuestion && <span>{t('Domanda:')} {candidate.sourceQuestion.slice(0, 120)}</span>}
      <span>{t('Creazione candidato:')} {createdAt ?? '—'}</span>
      {sourceAt && <span>{t('Messaggio originale:')} {sourceAt}</span>}
      <span title={candidate.sessionId}>{t('Sessione:')} <code>{shortReference(candidate.sessionId)}</code></span>
      {candidate.sourceMessageId && <span title={candidate.sourceMessageId}>{t('Messaggio:')} <code>{shortReference(candidate.sourceMessageId)}</code></span>}
      {candidate.curatorModel && (
        <span>{t('Curator:')} {candidate.curatorProvider ? `${PROVIDER_LABELS[candidate.curatorProvider as keyof typeof PROVIDER_LABELS] ?? candidate.curatorProvider} / ` : ''}{candidate.curatorModel}</span>
      )}
    </div>
  );
}

export function MemoryInbox({ refreshKey = 0, projectId = null, onChanged, onCountChange }: MemoryInboxProps) {
  const { t, language } = useI18n();
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [autoApproved, setAutoApproved] = useState<MemoryCandidate[]>([]);
  const [autoApprovedTotal, setAutoApprovedTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const all = await listMemoryCandidates(undefined, projectId ?? undefined);
      const pending = all.filter((candidate) => candidate.status === 'pending' || candidate.status === 'conflict');
      setCandidates(pending);
      const automatic = all
        .filter(candidate => candidate.status === 'approved' && candidate.approvedBy === 'auto')
        .sort((a, b) => (b.autoApprovedAt ?? b.updatedAt) - (a.autoApprovedAt ?? a.updatedAt));
      setAutoApprovedTotal(automatic.length);
      setAutoApproved(automatic.slice(0, 12));
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    onCountChange?.(candidates.length);
  }, [candidates.length, onCountChange]);

  const startEdit = (candidate: MemoryCandidate) => {
    setEditingId(candidate.id);
    setEditText(candidate.proposedText);
    setEditTarget(candidate.targetPath);
    setNotice(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
    setEditTarget('');
  };

  const saveEdit = async (candidate: MemoryCandidate) => {
    if (!editText.trim()) return;
    setActionId(candidate.id);
    setError(null);
    setNotice(null);
    try {
      await updateMemoryCandidate(candidate.id, {
        proposedText: editText.trim(),
        targetPath: editTarget.trim(),
      });
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
    }
  };

  const approve = async (candidate: MemoryCandidate) => {
    setActionId(candidate.id);
    setError(null);
    setNotice(null);
    try {
      const result = await approveMemoryCandidate(candidate.id);
      setNotice(result.markdownChanged
        ? `Scritto in ${result.candidate.writtenPath}`
        : `Nessuna nuova scrittura: contenuto già presente in ${result.candidate.writtenPath}`);
      setCandidates((current) => current.filter((item) => item.id !== candidate.id));
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
    }
  };

  const reject = async (candidate: MemoryCandidate) => {
    setActionId(candidate.id);
    setError(null);
    setNotice(null);
    try {
      await rejectMemoryCandidate(candidate.id);
      setCandidates((current) => current.filter((item) => item.id !== candidate.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
    }
  };

  return (
    <section className="memory-inbox" aria-label={t('Memory Inbox')}>
      <div className="memory-inbox-header">
        <div>
          <h3>Memory Inbox ({candidates.length})</h3>
          <p>{t('Candidati da rivedere. I nuovi ricordi possono essere approvati automaticamente se l’opzione è attiva.')}</p>
        </div>
        <button type="button" className="memory-inbox-refresh" onClick={() => void load()} disabled={loading}>
          {loading ? t('Aggiorno…') : t('Aggiorna')}
        </button>
      </div>

      {error && <div role="alert" className="memory-inbox-error">{error}</div>}
      {notice && <div className="memory-inbox-notice">{notice}</div>}

      {!loading && candidates.length === 0 && (
        <div className="memory-inbox-empty">{t('Nessun candidato in attesa.')}</div>
      )}

      <div className="memory-inbox-list">
        {candidates.map((candidate) => {
          const isEditing = editingId === candidate.id;
          const isWorking = actionId === candidate.id;

          return (
            <article className={`memory-candidate is-${candidate.status}`} key={candidate.id}>
              <div className="memory-candidate-top">
                {candidate.action && <span className="memory-candidate-category">{{ new: 'Nuovo', update: 'Aggiornamento', duplicate: 'Duplicato', conflict: 'Conflitto' }[candidate.action]}</span>}
                <span className="memory-candidate-category">{categoryLabels[candidate.category] ?? candidate.category}</span>
                {candidate.project && <span className="memory-candidate-project">{candidate.project}</span>}
                <span className={`memory-candidate-status is-${candidate.status}`}>
                  {t(candidate.status === 'conflict' ? 'Conflitto' : 'Da rivedere')}
                </span>
                {candidate.priority === 'high' && <span className="memory-candidate-priority">{t('priorità alta')}</span>}
              </div>

              {candidate.currentText && <div className="memory-candidate-match"><strong>{t('Attuale')}</strong><div>{candidate.currentText}</div></div>}
              {isEditing ? (
                <div className="memory-candidate-edit">
                  <label>
                    Testo proposto
                    <textarea value={editText} onChange={(event) => setEditText(event.target.value)} rows={3} />
                  </label>
                  <label>
                    Destinazione Markdown
                    <input value={editTarget} onChange={(event) => setEditTarget(event.target.value)} />
                  </label>
                </div>
              ) : (
                <p className="memory-candidate-text"><strong>{t('Proposto:')}</strong> {candidate.proposedText}</p>
              )}

              <div className="memory-candidate-meta">
                <span>{t('Destinazione:')} <code>{isEditing ? editTarget : candidate.targetPath}</code></span>
                {candidate.heading && <span>{t('Sezione:')} <code>## {candidate.heading}</code></span>}
                <span>Origine: {t(candidate.origin === 'explicit' ? 'richiesta esplicita' : 'estrazione automatica')}</span>
                {candidate.updateIntent && <span>Tipo aggiornamento: {{ augment: 'aggiunta', replace: 'sostituzione', remove: 'rimozione', correct: 'correzione' }[candidate.updateIntent]}</span>}
                {candidate.salienceScore !== undefined && <span>Rilevanza: {candidate.salienceScore >= 0.8 ? 'alta' : candidate.salienceScore >= 0.5 ? 'media' : 'bassa'}</span>}
                {candidate.confidenceScore !== undefined && <span>Confidenza: {Math.round(candidate.confidenceScore * 100)}%</span>}
              </div>

              <MemoryCandidateProvenance candidate={candidate} />

              <p className="memory-candidate-rationale">{candidate.rationale}</p>

              {candidate.duplicateOf && (
                <div className="memory-candidate-match">
                  <strong>{t('Possibile duplicato')}</strong> in <code>{candidate.duplicateOf.relativePath}</code>
                  <div>{candidate.duplicateOf.content}</div>
                </div>
              )}
              {candidate.conflictsWith && (
                <div className="memory-candidate-match is-conflict">
                  <strong>{t('Possibile informazione esistente da confrontare')}</strong> in <code>{candidate.conflictsWith.relativePath}</code>
                  <div>{candidate.conflictsWith.content}</div>
                  <small>L’approvazione aggiunge il nuovo contenuto; il vecchio non viene cancellato automaticamente.</small>
                </div>
              )}

              <div className="memory-candidate-actions">
                {isEditing ? (
                  <>
                    <button type="button" className="memory-action-primary" onClick={() => void saveEdit(candidate)} disabled={isWorking || !editText.trim()}>
                      {isWorking ? t('Salvo…') : t('Salva modifica')}
                    </button>
                    <button type="button" onClick={cancelEdit} disabled={isWorking}>{t('Annulla')}</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="memory-action-primary" onClick={() => void approve(candidate)} disabled={isWorking}>
                      {isWorking ? t('Elaboro…') : t('Approva')}
                    </button>
                    <button type="button" onClick={() => startEdit(candidate)} disabled={isWorking}>{t('Modifica')}</button>
                    <button type="button" className="memory-action-danger" onClick={() => void reject(candidate)} disabled={isWorking}>{t('Rifiuta')}</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {autoApproved.length > 0 && (
        <details className="memory-auto-saved">
          <summary>{t('Salvati automaticamente ({count})', { count: autoApprovedTotal })}</summary>
          <p>{t('Ricordi approvati automaticamente. Puoi modificarli o rimuoverli dal Second Brain.')}</p>
          <div className="memory-auto-saved-list">
            {autoApproved.map(candidate => (
              <article className="memory-auto-saved-item" key={candidate.id}>
                <div className="memory-auto-saved-head">
                  <span className="memory-candidate-category">{categoryLabels[candidate.category] ?? candidate.category}</span>
                  <span>{formatTimestamp(candidate.autoApprovedAt ?? candidate.updatedAt, language) ?? '—'}</span>
                </div>
                <p>{candidate.proposedText}</p>
                <code>{candidate.writtenPath ?? candidate.targetPath}</code>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
