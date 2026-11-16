import { useState } from 'react';
import { deleteMemorySource, updateMemorySource } from '../lib/api';
import type { MemoryHistoryRecord, MemorySourceDetail } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';

export interface SourceHighlight {
  heading: string | null;
  startLine: number;
  endLine: number;
  content: string;
}

interface MemorySourceDetailProps {
  source: MemorySourceDetail;
  highlight?: SourceHighlight | null;
  history?: MemoryHistoryRecord[];
  onBack: () => void;
  onSaved: (source: MemorySourceDetail) => void;
  onDeleted: (sourceId: string) => void;
}

const CORE_FILES = new Set([
  'memory/profile.md',
  'memory/preferences.md',
  'memory/decisions.md',
]);

export function MemorySourceDetail({
  source,
  highlight,
  history = [],
  onBack,
  onSaved,
  onDeleted,
}: MemorySourceDetailProps) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(source.content);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCoreFile = CORE_FILES.has(source.relativePath);

  const startEditing = () => {
    setContent(source.content);
    setEditing(true);
    setError(null);
  };

  const cancelEditing = () => {
    setContent(source.content);
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMemorySource(source.id, content);
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteMemorySource(source.id);
      onDeleted(source.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <section className="source-detail" aria-label={`Fonte ${source.relativePath}`}>
      <div className="source-detail-toolbar">
        <button type="button" className="source-back" onClick={onBack}>← Fonti</button>
        <div className="source-detail-actions">
          {!editing && <button type="button" onClick={startEditing}>Modifica</button>}
          {!editing && !isCoreFile && (
            <button type="button" className="memory-action-danger" onClick={() => setConfirmDelete(true)}>Elimina</button>
          )}
        </div>
      </div>

      <div className="source-detail-heading">
        <div className="source-detail-path">{source.relativePath}</div>
        <div className="source-detail-meta">
          <span>{source.category}</span>
          <span>{new Date(source.modifiedAt).toLocaleString('it-IT')}</span>
          <span>{source.chunkCount} chunk</span>
          {source.title && <span>{source.title}</span>}
        </div>
        {isCoreFile && (
          <p className="source-core-note">
            File core condiviso: la modifica è disponibile, l’eliminazione completa del file è nascosta.
          </p>
        )}
      </div>

      {error && <div role="alert" className="memory-inbox-error">{error}</div>}

      {highlight && (
        <div className="source-highlight">
          <div className="source-highlight-title">
            Risultato ricerca: {highlight.heading ?? '(nessun heading)'} · L{highlight.startLine}-L{highlight.endLine}
          </div>
          <div className="source-highlight-content">{highlight.content}</div>
        </div>
      )}

      {editing ? (
        <div className="source-editor">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            spellCheck={false}
            aria-label="Contenuto Markdown della fonte"
          />
          <div className="source-editor-actions">
            <button type="button" onClick={cancelEditing} disabled={saving}>Annulla</button>
            <button type="button" className="memory-action-primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Salvo…' : 'Salva'}
            </button>
          </div>
        </div>
      ) : (
        <div
          className="source-content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(source.content) }}
        />
      )}

      {history.length > 0 && (
        <details className="source-history" open={history.some(record => record.status === 'superseded')}>
          <summary>Storico versioni ({history.length})</summary>
          <div className="source-history-list">
            {history.map((record) => (
              <article className={`source-history-item is-${record.status}`} key={record.versionId}>
                <div className="source-history-meta">
                  <span className={`source-history-status is-${record.status}`}>{record.status === 'active' ? 'Attiva' : 'Superata'}</span>
                  <span>v{record.version}</span>
                  <span>{new Date(record.updatedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  {record.curatorModel && <span>{record.curatorProvider ? `${record.curatorProvider} / ` : ''}{record.curatorModel}</span>}
                  {record.sourceSessionId && <span title={record.sourceSessionId}>Sessione: {record.sourceSessionId.slice(0, 12)}…</span>}
                </div>
                <p>{record.text}</p>
              </article>
            ))}
          </div>
        </details>
      )}

      {confirmDelete && (
        <div
          role="presentation"
          className="dialog-backdrop"
          onClick={() => { if (!deleting) setConfirmDelete(false); }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="source-delete-title" className="delete-dialog" onClick={(event) => event.stopPropagation()}>
            <h2 id="source-delete-title">Eliminare questa memoria dal Second Brain?</h2>
            <p>Il file Markdown verrà eliminato definitivamente.</p>
            <p className="source-delete-path"><code>{source.relativePath}</code></p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Annulla</button>
              <button type="button" className="delete-confirm-button" onClick={() => void remove()} disabled={deleting}>
                {deleting ? 'Eliminazione…' : 'Elimina definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
