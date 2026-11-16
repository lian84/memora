import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { isOfficeArtifactKind, type ArtifactVersion, type ChatArtifact } from '@memora/shared';
import { artifactPreviewUrl, artifactUrl, artifactVersionUrl, createArtifactPdf, deleteArtifact, listArtifactVersions } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { PdfPreview } from './PdfPreview';
import { ConfirmDialog } from './ConfirmDialog';
import { HtmlPreview } from './HtmlPreview';
import { ZoomControls } from './ZoomControls';
import { SpreadsheetPreview } from './SpreadsheetPreview';

interface ArtifactsPanelProps {
  sessionId: string | null;
  artifacts: ChatArtifact[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onAttachArtifact?: (artifact: ChatArtifact) => Promise<void> | void;
  onAddArtifactToProject?: (artifact: ChatArtifact) => Promise<{ destination: 'source' | 'file'; relativePath: string; indexed: boolean }>;
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ArtifactsPanel({ sessionId, artifacts, loading = false, error = null, onRefresh, onAttachArtifact, onAddArtifactToProject }: ArtifactsPanelProps) {
  const [selected, setSelected] = useState<ChatArtifact | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number>(1);
  const [zoom, setZoom] = useState(1);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [artifactNotice, setArtifactNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [addingToProjectId, setAddingToProjectId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatArtifact | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => { setSelected(null); setContent(null); setPreviewError(null); setPdfNotice(null); setVersions([]); setArtifactNotice(null); setDeleteTarget(null); setDeleteError(null); }, [sessionId]);
  useEffect(() => {
    if (selected) setSelected(current => artifacts.find(artifact => artifact.id === current?.id) ?? current);
  }, [artifacts]);
  useEffect(() => {
    if (!selected || !sessionId) { setVersions([]); return; }
    let cancelled = false;
    setSelectedVersion(selected.version);
    void listArtifactVersions(sessionId, selected.id).then(result => {
      if (!cancelled) setVersions(result);
    }).catch(() => { if (!cancelled) setVersions([]); });
    return () => { cancelled = true; };
  }, [selected?.id, selected?.version, sessionId]);
  useEffect(() => { setZoom(1); }, [selected?.id, selectedVersion]);
  const selectedUrl = sessionId && selected
    ? (selectedVersion === selected.version ? artifactUrl(sessionId, selected.id) : artifactVersionUrl(sessionId, selected.id, selectedVersion))
    : null;

  useEffect(() => {
    if (!selected || !sessionId || !selectedUrl) { setContent(null); return; }
    if (selected.kind === 'pdf' || isOfficeArtifactKind(selected.kind)) { setContent(null); setPreviewError(null); return; }
    let cancelled = false;
    setContent(null);
    setPreviewError(null);
    fetch(selectedUrl)
      .then(async response => {
        if (!response.ok) throw new Error(`Impossibile leggere l’artefatto (${response.status})`);
        return response.text();
      })
      .then(text => { if (!cancelled) setContent(text); })
      .catch(err => { if (!cancelled) setPreviewError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [selected, sessionId, selectedUrl]);

  const attachArtifact = async (artifact: ChatArtifact) => {
    if (!onAttachArtifact) return;
    setAttachingId(artifact.id);
    setArtifactNotice(null);
    try {
      await onAttachArtifact(artifact);
      setArtifactNotice({ text: `${artifact.name} allegato al messaggio.`, error: false });
    } catch (err) {
      setArtifactNotice({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setAttachingId(null);
    }
  };

  const addArtifactToProject = async (artifact: ChatArtifact) => {
    if (!onAddArtifactToProject) return;
    setAddingToProjectId(artifact.id);
    setArtifactNotice(null);
    try {
      const result = await onAddArtifactToProject(artifact);
      setArtifactNotice({
        text: result.indexed
          ? `${artifact.name} aggiunto alle fonti del progetto (${result.relativePath}).`
          : `${artifact.name} aggiunto ai file del progetto (${result.relativePath}).`,
        error: false,
      });
    } catch (err) {
      setArtifactNotice({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setAddingToProjectId(null);
    }
  };

  const removeArtifact = async () => {
    if (!sessionId || !deleteTarget) return;
    setDeletingId(deleteTarget.id);
    setDeleteError(null);
    try {
      await deleteArtifact(sessionId, deleteTarget.id);
      if (selected?.id === deleteTarget.id) setSelected(null);
      setArtifactNotice({ text: `${deleteTarget.name} eliminato.`, error: false });
      setDeleteTarget(null);
      onRefresh?.();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  const exportPdf = async (artifact: ChatArtifact) => {
    if (!sessionId) return;
    setPdfBusy(true);
    setPdfNotice(null);
    try {
      const created = await createArtifactPdf(sessionId, artifact.id);
      setPdfNotice(`PDF creato: ${created.name}`);
      onRefresh?.();
    } catch (err) {
      setPdfNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPdfBusy(false);
    }
  };

  const previewStyle: CSSProperties | undefined = selected?.kind === 'pdf'
    ? undefined
    : { zoom, width: `${100 / zoom}%`, height: `${100 / zoom}%` } as CSSProperties;

  return (
    <div className={`artifacts-panel${selected ? ' is-detail' : ''}`}>
      {selected ? (
        <div className="artifact-detail">
          <div className="artifact-detail-head">
            <button type="button" className="project-file-back" onClick={() => setSelected(null)}>← Artefatti</button>
          </div>
          <div className="artifact-detail-title">
            <strong title={selected.name}>{selected.name}</strong>
            {versions.length > 1 && (
              <label className="artifact-version-select artifact-version-inline" title="Seleziona variante">
                <span>Variante</span>
                <select aria-label="Seleziona variante" value={selectedVersion} onChange={event => setSelectedVersion(Number(event.target.value))}>
                  {versions.map(item => <option key={item.version} value={item.version}>v{item.version}{item.current ? ' · corrente' : ''}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="artifact-detail-actions">
            {selectedUrl && <a className="project-file-download" href={selectedUrl} target="_blank" rel="noreferrer">Apri</a>}
            <button type="button" className="artifact-action is-danger" onClick={() => { setDeleteError(null); setDeleteTarget(selected); }} title={`Elimina ${selected.name}`} aria-label={`Elimina ${selected.name}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg>
            </button>
            {onAttachArtifact && (
              <button type="button" className="artifact-action" onClick={() => void attachArtifact(selected)} disabled={attachingId === selected.id} title={`Allega ${selected.name} al messaggio`} aria-label={`Allega ${selected.name} al messaggio`}>
                {attachingId === selected.id ? <span className="artifact-action-loading">…</span> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 6" /></svg>}
              </button>
            )}
            {onAddArtifactToProject && (
              <button type="button" className="artifact-action" onClick={() => void addArtifactToProject(selected)} disabled={addingToProjectId === selected.id} title={`Aggiungi ${selected.name} al contesto del progetto`} aria-label={`Aggiungi ${selected.name} al contesto del progetto`}>
                {addingToProjectId === selected.id ? <span className="artifact-action-loading">…</span> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h6l2 2h10v10H3z" /><path d="M12 13v5M9.5 15.5h5" /></svg>}
              </button>
            )}
          </div>
          <div className="artifact-detail-meta">
            <span>{selected.kind} · v{selectedVersion} · {formatSize(versions.find(item => item.version === selectedVersion)?.size ?? selected.size)}</span>
            {selectedVersion === selected.version && selected.kind !== 'pdf' && (selected.kind === 'html' || selected.kind === 'markdown' || selected.kind === 'text') && (
              <button type="button" className="project-file-attach" onClick={() => void exportPdf(selected)} disabled={pdfBusy}>{pdfBusy ? 'Converto…' : 'Esporta PDF'}</button>
            )}
          </div>
          {artifactNotice && <div className={`artifact-notice${artifactNotice.error ? ' is-error' : ''}`} role="status">{artifactNotice.text}</div>}
          {pdfNotice && <div className="project-file-notice" role="status">{pdfNotice}</div>}
          {previewError && <div className="project-file-preview-error">{previewError}</div>}
          <div className="artifact-preview">
            {selected.kind === 'html' || selected.kind === 'svg' ? (
              previewError
                ? <div className="project-file-preview-error">{previewError}</div>
                : content === null
                  ? <div className="project-file-preview-empty">Caricamento anteprima…</div>
                  : <HtmlPreview title={`${selected.name} · v${selectedVersion}`} html={content} openUrl={selectedUrl ?? undefined} />
            ) : selected.kind === 'docx' && sessionId ? (
              <HtmlPreview
                title={`${selected.name} · v${selectedVersion}`}
                url={artifactPreviewUrl(sessionId, selected.id, selectedVersion === selected.version ? undefined : selectedVersion)}
                openUrl={selectedUrl ?? undefined}
              />
            ) : selected.kind === 'xlsx' && sessionId ? (
              <SpreadsheetPreview
                sessionId={sessionId}
                artifactId={selected.id}
                version={selectedVersion === selected.version ? undefined : selectedVersion}
                title={`${selected.name} · v${selectedVersion}`}
              />
            ) : selected.kind === 'pptx' && sessionId && selectedVersion === selected.version ? (
              <HtmlPreview
                title={`${selected.name} · v${selectedVersion}`}
                url={artifactPreviewUrl(sessionId, selected.id)}
                openUrl={selectedUrl ?? undefined}
              />
            ) : selected.kind === 'pptx' ? (
              <div className="project-file-preview-empty">L’anteprima PPTX è disponibile per la versione corrente. Puoi scaricare questa variante.</div>
            ) : isOfficeArtifactKind(selected.kind) ? (
              <div className="project-file-preview-empty">Anteprima Office in preparazione. Puoi aprire o scaricare il file.</div>
            ) : (
              <>
                <div className="artifact-preview-toolbar">
                  <span>Anteprima</span>
                  <ZoomControls zoom={zoom} onChange={setZoom} />
                </div>
                <div className="artifact-preview-scroll">
                  {selected.kind === 'pdf' && selectedUrl && <div className="artifact-preview-content is-pdf"><PdfPreview url={selectedUrl} title={`${selected.name} · v${selectedVersion}`} zoom={zoom} /></div>}
                  {selected.kind !== 'pdf' && !previewError && content === null && <div className="project-file-preview-empty">Caricamento anteprima…</div>}
                  {selected.kind !== 'pdf' && !previewError && content !== null && (
                    <div className="artifact-preview-content" style={previewStyle}>
                      {selected.kind === 'markdown'
                        ? <div className="project-file-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
                        : <pre className="project-file-text">{content}</pre>}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="artifacts-toolbar">
            <span>{artifacts.length} artefatti</span>
            {onRefresh && <button type="button" onClick={onRefresh} disabled={loading}>{loading ? 'Caricamento…' : 'Aggiorna'}</button>}
          </div>
          {error && <div className="project-files-error" role="alert">{error}</div>}
          {!loading && artifacts.length === 0 && (
            <div className="project-files-empty">Nessun artefatto. Chiedi a Memo di creare un documento, una pagina o un file.</div>
          )}
          {artifactNotice && <div className={`artifact-notice${artifactNotice.error ? ' is-error' : ''}`} role="status">{artifactNotice.text}</div>}
          <div className="artifact-list">
            {artifacts.map(artifact => (
              <div className="artifact-row" key={artifact.id}>
                <button type="button" className="artifact-row-open" onClick={() => { setArtifactNotice(null); setSelected(artifact); }}>
                  <span className={`project-file-badge is-${artifact.kind}`}>{artifact.name.split('.').pop()?.toUpperCase() ?? 'FILE'}</span>
                  <span className="artifact-row-main">
                    <strong>{artifact.name}</strong>
                    <small>v{artifact.version} · {formatDate(artifact.updatedAt)} · {formatSize(artifact.size)}</small>
                  </span>
                </button>
                <div className="artifact-row-actions">
                  <a className="artifact-action" href={sessionId ? artifactUrl(sessionId, artifact.id) : undefined} download={artifact.name} title={`Scarica ${artifact.name}`} aria-label={`Scarica ${artifact.name}`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 17v3h16v-3" /></svg>
                  </a>
                  {onAttachArtifact && (
                    <button type="button" className="artifact-action" onClick={() => void attachArtifact(artifact)} disabled={attachingId === artifact.id} title={`Allega ${artifact.name} al messaggio`} aria-label={`Allega ${artifact.name} al messaggio`}>
                      {attachingId === artifact.id ? <span className="artifact-action-loading">…</span> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 6" /></svg>}
                    </button>
                  )}
                  <button type="button" className="artifact-action is-danger" onClick={() => { setDeleteError(null); setDeleteTarget(artifact); }} disabled={deletingId === artifact.id} title={`Elimina ${artifact.name}`} aria-label={`Elimina ${artifact.name}`}>
                    {deletingId === artifact.id ? <span className="artifact-action-loading">…</span> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={`Eliminare “${deleteTarget.name}”?`}
          confirmLabel="Elimina artefatto"
          busyLabel="Eliminazione…"
          busy={deletingId === deleteTarget.id}
          error={deleteError}
          onClose={() => { setDeleteTarget(null); setDeleteError(null); }}
          onConfirm={() => void removeArtifact()}
        >
          <p>Verranno eliminate anche tutte le versioni archiviate. L’operazione non può essere annullata.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
