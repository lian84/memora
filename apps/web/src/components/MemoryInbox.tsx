import { useCallback, useEffect, useState } from 'react';
import {
  approveMemoryCandidate,
  listMemoryCandidates,
  rejectMemoryCandidate,
  updateMemoryCandidate,
} from '../lib/api';
import { PROVIDER_LABELS, type MemoryCandidate } from '@memora/shared';

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

function formatTimestamp(value: number | undefined): string | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return new Date(value).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

export function MemoryCandidateProvenance({ candidate }: { candidate: MemoryCandidate }) {
  const createdAt = formatTimestamp(candidate.createdAt);
  const sourceAt = formatTimestamp(candidate.sourceTimestamp);
  return (
    <div className="memory-candidate-provenance">
      <span>Stato: <strong>{candidate.status}</strong></span>
      <span>Origine: <strong>{candidate.sourceKind === 'assistant' ? 'risposta assistente' : 'utente'}</strong></span>
      {candidate.sourceQuestion && <span>Domanda: {candidate.sourceQuestion.slice(0, 120)}</span>}
      <span>Creazione candidato: {createdAt ?? '—'}</span>
      {sourceAt && <span>Messaggio originale: {sourceAt}</span>}
      <span title={candidate.sessionId}>Sessione: <code>{shortReference(candidate.sessionId)}</code></span>
      {candidate.sourceMessageId && <span title={candidate.sourceMessageId}>Messaggio: <code>{shortReference(candidate.sourceMessageId)}</code></span>}
      {candidate.curatorModel && (
        <span>Curator: {candidate.curatorProvider ? `${PROVIDER_LABELS[candidate.curatorProvider as keyof typeof PROVIDER_LABELS] ?? candidate.curatorProvider} / ` : ''}{candidate.curatorModel}</span>
      )}
    </div>
  );
}

export function MemoryInbox({ refreshKey = 0, projectId = null, onChanged, onCountChange }: MemoryInboxProps) {
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
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
    <section className="memory-inbox" aria-label="Memory Inbox">
      <div className="memory-inbox-header">
        <div>
          <h3>Memory Inbox ({candidates.length})</h3>
          <p>Candidati da rivedere. Nulla viene scritto nel Second Brain senza approvazione.</p>
        </div>
        <button type="button" className="memory-inbox-refresh" onClick={() => void load()} disabled={loading}>
          {loading ? 'Aggiorno…' : 'Aggiorna'}
        </button>
      </div>

      {error && <div role="alert" className="memory-inbox-error">{error}</div>}
      {notice && <div className="memory-inbox-notice">{notice}</div>}

      {!loading && candidates.length === 0 && (
        <div className="memory-inbox-empty">Nessun candidato in attesa.</div>
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
                  {candidate.status === 'conflict' ? 'Conflitto' : 'Da rivedere'}
                </span>
                {candidate.priority === 'high' && <span className="memory-candidate-priority">priorità alta</span>}
              </div>

              {candidate.currentText && <div className="memory-candidate-match"><strong>Attuale</strong><div>{candidate.currentText}</div></div>}
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
                <p className="memory-candidate-text"><strong>Proposto:</strong> {candidate.proposedText}</p>
              )}

              <div className="memory-candidate-meta">
                <span>Destinazione: <code>{isEditing ? editTarget : candidate.targetPath}</code></span>
                {candidate.heading && <span>Sezione: <code>## {candidate.heading}</code></span>}
                <span>Origine: {candidate.origin === 'explicit' ? 'richiesta esplicita' : 'estrazione automatica'}</span>
                {candidate.updateIntent && <span>Tipo aggiornamento: {{ augment: 'aggiunta', replace: 'sostituzione', remove: 'rimozione', correct: 'correzione' }[candidate.updateIntent]}</span>}
                {candidate.salienceScore !== undefined && <span>Rilevanza: {candidate.salienceScore >= 0.8 ? 'alta' : candidate.salienceScore >= 0.5 ? 'media' : 'bassa'}</span>}
                {candidate.confidenceScore !== undefined && <span>Confidenza: {Math.round(candidate.confidenceScore * 100)}%</span>}
              </div>

              <MemoryCandidateProvenance candidate={candidate} />

              <p className="memory-candidate-rationale">{candidate.rationale}</p>

              {candidate.duplicateOf && (
                <div className="memory-candidate-match">
                  <strong>Possibile duplicato</strong> in <code>{candidate.duplicateOf.relativePath}</code>
                  <div>{candidate.duplicateOf.content}</div>
                </div>
              )}
              {candidate.conflictsWith && (
                <div className="memory-candidate-match is-conflict">
                  <strong>Possibile informazione esistente da confrontare</strong> in <code>{candidate.conflictsWith.relativePath}</code>
                  <div>{candidate.conflictsWith.content}</div>
                  <small>L’approvazione aggiunge il nuovo contenuto; il vecchio non viene cancellato automaticamente.</small>
                </div>
              )}

              <div className="memory-candidate-actions">
                {isEditing ? (
                  <>
                    <button type="button" className="memory-action-primary" onClick={() => void saveEdit(candidate)} disabled={isWorking || !editText.trim()}>
                      {isWorking ? 'Salvo…' : 'Salva modifica'}
                    </button>
                    <button type="button" onClick={cancelEdit} disabled={isWorking}>Annulla</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="memory-action-primary" onClick={() => void approve(candidate)} disabled={isWorking}>
                      {isWorking ? 'Elaboro…' : 'Approva'}
                    </button>
                    <button type="button" onClick={() => startEdit(candidate)} disabled={isWorking}>Modifica</button>
                    <button type="button" className="memory-action-danger" onClick={() => void reject(candidate)} disabled={isWorking}>Rifiuta</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
