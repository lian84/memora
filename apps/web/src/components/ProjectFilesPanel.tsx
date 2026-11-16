import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatArtifact, ProjectFileInfo, ProjectRecord, SessionContextSettings, SpreadsheetPreview } from '@memora/shared';
import { getProjectFilePreview, getProjectFileText, listProjectFiles, projectFileUrl } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { SessionContextPanel } from './SessionContextPanel';
import { ArtifactsPanel } from './ArtifactsPanel';
import { PdfPreview } from './PdfPreview';
import { HtmlPreview } from './HtmlPreview';
import { SpreadsheetView } from './SpreadsheetView';
import { PanelResizeHandle } from './PanelResizeHandle';
import { PANEL_DEFAULT_WIDTH, PANEL_EXPANDED_WIDTH, usePanelWidth } from '../lib/panel-width';

interface ProjectFilesPanelProps {
  project: ProjectRecord;
  onClose?: () => void;
  onAttach?: (file: ProjectFileInfo) => Promise<void> | void;
  context?: SessionContextSettings | null;
  contextSaving?: boolean;
  contextError?: string | null;
  onContextChange?: (patch: Partial<SessionContextSettings>) => Promise<void> | void;
  refreshKey?: number;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  sessionId?: string | null;
  artifacts?: ChatArtifact[];
  artifactsLoading?: boolean;
  artifactsError?: string | null;
  onRefreshArtifacts?: () => void;
  onAttachArtifact?: (artifact: ChatArtifact) => Promise<void> | void;
  onAddArtifactToProject?: (artifact: ChatArtifact) => Promise<{ destination: 'source' | 'file'; relativePath: string; indexed: boolean }>;
}

type PreviewState =
  | { kind: 'text' | 'markdown'; content: string }
  | { kind: 'word'; html: string }
  | { kind: 'html' | 'pdf' | 'image' | 'pptx'; url: string }
  | { kind: 'xlsx'; data: SpreadsheetPreview }
  | { kind: 'error'; message: string }
  | null;

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileBadge(file: ProjectFileInfo): string {
  return file.extension ? file.extension.toUpperCase() : 'FILE';
}

export function ProjectFilesPanel({ project, onClose, onAttach, context = null, contextSaving = false, contextError = null, onContextChange, refreshKey = 0, expanded = false, onToggleExpanded, sessionId = null, artifacts = [], artifactsLoading = false, artifactsError = null, onRefreshArtifacts, onAttachArtifact, onAddArtifactToProject }: ProjectFilesPanelProps) {
  const [files, setFiles] = useState<ProjectFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ProjectFileInfo | null>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachedMessage, setAttachedMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'files' | 'context' | 'artifacts'>('files');
  const { width: panelWidth, setWidth: setPanelWidth, startResize } = usePanelWidth();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listProjectFiles(project.id);
      setFiles(result.files);
      setSelected(current => current && result.files.some(file => file.path === current.path) ? current : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => { setSelected(null); setAttachedMessage(null); setActiveTab('files'); }, [project.id]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return files;
    return files.filter(file => file.path.toLowerCase().includes(normalized));
  }, [files, query]);

  const groups = useMemo(() => {
    const map = new Map<string, ProjectFileInfo[]>();
    for (const file of filtered) {
      const list = map.get(file.directory) ?? [];
      list.push(file);
      map.set(file.directory, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'it'));
  }, [filtered]);

  const openPreview = useCallback(async (file: ProjectFileInfo) => {
    setSelected(file);
    setPreview(null);
    setAttachedMessage(null);
    if (file.kind === 'other') return;
    setPreviewLoading(true);
    try {
      if (file.kind === 'markdown' || file.kind === 'text') {
        setPreview({ kind: file.kind, content: await getProjectFileText(project.id, file.path) });
      } else if (file.kind === 'word') {
        const result = await getProjectFilePreview(project.id, file.path);
        setPreview({ kind: 'word', html: result.html ?? '' });
      } else if (file.kind === 'xlsx') {
        const result = await getProjectFilePreview(project.id, file.path);
        if (!result.spreadsheet) throw new Error('Anteprima Excel non disponibile');
        setPreview({ kind: 'xlsx', data: result.spreadsheet });
      } else {
        setPreview({ kind: file.kind, url: projectFileUrl(project.id, file.path) });
      }
    } catch (err) {
      setPreview({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setPreviewLoading(false);
    }
  }, [project.id]);

  const attach = async (file: ProjectFileInfo) => {
    if (!onAttach) return;
    setAttaching(true);
    setAttachedMessage(null);
    try {
      await onAttach(file);
      setAttachedMessage(`${file.name} aggiunto agli allegati della chat.`);
    } catch (err) {
      setAttachedMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setAttaching(false);
    }
  };

  return (
    <aside className={`project-files-panel${expanded ? ' is-expanded' : ''}`} style={{ width: `${panelWidth}px`, flexBasis: `${panelWidth}px` }} aria-label={`File del progetto ${project.name}`}>
      <PanelResizeHandle width={panelWidth} onStartResize={startResize} onResize={setPanelWidth} />
      <header className="project-files-header">
        <div>
          <span className="project-files-eyebrow">Progetto</span>
          <h2 title={project.name}>{project.name}</h2>
        </div>
        <div className="project-files-header-actions">
          <button type="button" className="project-files-icon" onClick={() => void load()} disabled={loading} title="Aggiorna file" aria-label="Aggiorna file">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.3-5.7" /><path d="M20 4v7h-7" /></svg>
          </button>
          {onToggleExpanded && (
            <button type="button" className="project-files-icon" onClick={() => { setPanelWidth(expanded ? PANEL_DEFAULT_WIDTH : PANEL_EXPANDED_WIDTH); onToggleExpanded?.(); }} title={expanded ? 'Riduci pannello' : 'Espandi pannello'} aria-label={expanded ? 'Riduci pannello' : 'Espandi pannello'}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /></svg>
            </button>
          )}
          {onClose && (
            <button type="button" className="project-files-icon" onClick={onClose} title="Comprimi file progetto" aria-label="Comprimi file progetto">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          )}
        </div>
      </header>

      <nav className="project-files-tabs" role="tablist" aria-label="Pannello progetto">
        <button type="button" role="tab" aria-selected={activeTab === 'files'} className={activeTab === 'files' ? 'is-active' : ''} onClick={() => setActiveTab('files')}>File</button>
        <button type="button" role="tab" aria-selected={activeTab === 'context'} className={activeTab === 'context' ? 'is-active' : ''} onClick={() => setActiveTab('context')}>Contesto</button>
        <button type="button" role="tab" aria-selected={activeTab === 'artifacts'} className={activeTab === 'artifacts' ? 'is-active' : ''} onClick={() => setActiveTab('artifacts')}>Artefatti</button>
      </nav>

      {activeTab === 'artifacts' ? (
        <ArtifactsPanel
          sessionId={sessionId}
          artifacts={artifacts}
          loading={artifactsLoading}
          error={artifactsError}
          onRefresh={onRefreshArtifacts}
          onAttachArtifact={onAttachArtifact}
          onAddArtifactToProject={onAddArtifactToProject}
        />
      ) : activeTab === 'context' ? (
        <SessionContextPanel
          embedded
          context={context}
          saving={contextSaving}
          error={contextError}
          onChange={onContextChange ?? (() => undefined)}
        />
      ) : selected ? (
        <div className="project-file-detail">
          <div className="project-file-detail-bar">
            <button type="button" className="project-file-back" onClick={() => { setSelected(null); setPreview(null); setAttachedMessage(null); }}>← File</button>
            <span className={`project-file-badge is-${selected.kind}`}>{fileBadge(selected)}</span>
          </div>
          <h3 title={selected.path}>{selected.name}</h3>
          <p className="project-file-path">{selected.path}</p>
          <div className="project-file-detail-actions">
            <a className="project-file-download" href={projectFileUrl(project.id, selected.path)} target="_blank" rel="noreferrer">Apri / scarica</a>
            {onAttach && <button type="button" className="project-file-attach" onClick={() => void attach(selected)} disabled={attaching}>{attaching ? 'Aggiungo…' : 'Allega alla chat'}</button>}
          </div>
          {attachedMessage && <div className="project-file-notice" role="status">{attachedMessage}</div>}
          <div className="project-file-preview">
            {previewLoading && <div className="project-file-preview-empty">Caricamento anteprima…</div>}
            {!previewLoading && preview?.kind === 'error' && <div className="project-file-preview-error">{preview.message}</div>}
            {!previewLoading && preview?.kind === 'markdown' && <div className="project-file-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(preview.content) }} />}
            {!previewLoading && preview?.kind === 'text' && <pre className="project-file-text">{preview.content}</pre>}
            {!previewLoading && preview?.kind === 'html' && <HtmlPreview title={selected.name} url={preview.url} />}
            {!previewLoading && preview?.kind === 'pdf' && <PdfPreview url={preview.url} title={selected.name} />}
            {!previewLoading && preview?.kind === 'image' && <img className="project-file-image" src={preview.url} alt={selected.name} />}
            {!previewLoading && preview?.kind === 'xlsx' && <SpreadsheetView data={preview.data} title={selected.name} />}
            {!previewLoading && preview?.kind === 'pptx' && <div className="project-file-preview-empty">I PPTX caricati non hanno anteprima. Puoi aprire o scaricare il file.</div>}
            {!previewLoading && preview?.kind === 'word' && <HtmlPreview title={selected.name} html={preview.html} />}
            {!previewLoading && selected.kind === 'other' && <div className="project-file-preview-empty">Anteprima non disponibile per questo formato. Puoi aprirlo o scaricarlo.</div>}
          </div>
        </div>
      ) : (
        <>
          <div className="project-files-search">
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cerca file…" aria-label="Cerca file progetto" />
          </div>
          <div className="project-files-list">
            {loading && <div className="project-files-empty">Caricamento file…</div>}
            {!loading && error && <div className="project-files-error" role="alert">{error}</div>}
            {!loading && !error && groups.length === 0 && <div className="project-files-empty">{files.length === 0 ? 'Nessun file nel progetto.' : 'Nessun file corrispondente.'}</div>}
            {!loading && !error && groups.map(([directory, directoryFiles]) => (
              <section className="project-files-group" key={directory || '__root'}>
                <div className="project-files-group-title">{directory || 'Radice'}</div>
                {directoryFiles.map(file => (
                  <button type="button" className="project-file-row" key={file.path} onClick={() => void openPreview(file)} title={file.path}>
                    <span className={`project-file-badge is-${file.kind}`}>{fileBadge(file)}</span>
                    <span className="project-file-name">{file.name}</span>
                    <span className="project-file-size">{formatSize(file.size)}</span>
                  </button>
                ))}
              </section>
            ))}
          </div>
          <footer className="project-files-footer">{files.length} file · {project.id}</footer>
        </>
      )}
    </aside>
  );
}
