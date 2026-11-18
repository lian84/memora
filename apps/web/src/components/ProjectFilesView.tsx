import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectFileInfo, ProjectRecord, SpreadsheetPreview } from '@memora/shared';
import {
  getProjectFilePreview,
  getProjectFileText,
  listProjectFiles,
  projectFileUrl,
} from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { PdfPreview } from './PdfPreview';
import { HtmlPreview } from './HtmlPreview';
import { SpreadsheetView } from './SpreadsheetView';
import { useI18n } from '../i18n';

interface ProjectFilesViewProps {
  project: ProjectRecord;
  onAttach?: (file: ProjectFileInfo) => Promise<void> | void;
  refreshKey?: number;
}

type PreviewState =
  | { kind: 'text' | 'markdown'; content: string }
  | { kind: 'word'; html: string }
  | { kind: 'html' | 'pdf' | 'image' | 'pptx'; url: string }
  | { kind: 'xlsx'; data: SpreadsheetPreview }
  | { kind: 'error'; message: string }
  | null;

function formatSize(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileBadge(file: ProjectFileInfo): string {
  return file.extension ? file.extension.toUpperCase() : 'FILE';
}

export function ProjectFilesView({ project, onAttach, refreshKey = 0 }: ProjectFilesViewProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<ProjectFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ProjectFileInfo | null>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachedMessage, setAttachedMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listProjectFiles(project.id);
      setFiles(result.files);
      setSelected((current) =>
        current && result.files.some((file) => file.path === current.path) ? current : null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  useEffect(() => {
    setSelected(null);
    setAttachedMessage(null);
  }, [project.id]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return files;
    return files.filter((file) => file.path.toLowerCase().includes(normalized));
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

  const openPreview = useCallback(
    async (file: ProjectFileInfo) => {
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
    },
    [project.id]
  );

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

  if (selected) {
    return (
      <div className="project-files-view project-file-detail">
        <div className="project-file-detail-bar">
          <button
            type="button"
            className="project-file-back"
            onClick={() => {
              setSelected(null);
              setPreview(null);
              setAttachedMessage(null);
            }}
          >
            {t('← File')}
          </button>
          <span className={`project-file-badge is-${selected.kind}`}>{fileBadge(selected)}</span>
        </div>
        <h3 title={selected.path}>{selected.name}</h3>
        <p className="project-file-path">{selected.path}</p>
        <div className="project-file-detail-actions">
          <a
            className="project-file-download"
            href={projectFileUrl(project.id, selected.path)}
            target="_blank"
            rel="noreferrer"
          >
            {t('Apri / scarica')}
          </a>
          {onAttach && (
            <button
              type="button"
              className="project-file-attach"
              onClick={() => void attach(selected)}
              disabled={attaching}
            >
              {attaching ? t('Aggiungo…') : t('Allega alla chat')}
            </button>
          )}
        </div>
        {attachedMessage && (
          <div className="project-file-notice" role="status">
            {attachedMessage}
          </div>
        )}
        <div className="project-file-preview">
          {previewLoading && (
            <div className="project-file-preview-empty">{t('Caricamento anteprima…')}</div>
          )}
          {!previewLoading && preview?.kind === 'error' && (
            <div className="project-file-preview-error">{preview.message}</div>
          )}
          {!previewLoading && preview?.kind === 'markdown' && (
            <div
              className="project-file-markdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(preview.content) }}
            />
          )}
          {!previewLoading && preview?.kind === 'text' && (
            <pre className="project-file-text">{preview.content}</pre>
          )}
          {!previewLoading && preview?.kind === 'html' && (
            <HtmlPreview title={selected.name} url={preview.url} />
          )}
          {!previewLoading && preview?.kind === 'pdf' && (
            <PdfPreview url={preview.url} title={selected.name} />
          )}
          {!previewLoading && preview?.kind === 'image' && (
            <img className="project-file-image" src={preview.url} alt={selected.name} />
          )}
          {!previewLoading && preview?.kind === 'xlsx' && (
            <SpreadsheetView data={preview.data} title={selected.name} />
          )}
          {!previewLoading && preview?.kind === 'pptx' && (
            <div className="project-file-preview-empty">
              {t('I PPTX caricati non hanno anteprima. Puoi aprire o scaricare il file.')}
            </div>
          )}
          {!previewLoading && preview?.kind === 'word' && (
            <HtmlPreview title={selected.name} html={preview.html} />
          )}
          {!previewLoading && selected.kind === 'other' && (
            <div className="project-file-preview-empty">
              {t('Anteprima non disponibile per questo formato. Puoi aprirlo o scaricarlo.')}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="project-files-view">
      <div className="project-files-search-row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Cerca file…')}
          aria-label={t('Cerca file progetto')}
        />
        <button
          type="button"
          className="project-files-refresh"
          onClick={() => void load()}
          disabled={loading}
          title={t('Aggiorna file')}
          aria-label={t('Aggiorna file')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 11a8 8 0 1 1-2.3-5.7" />
            <path d="M20 4v7h-7" />
          </svg>
        </button>
      </div>
      <div className="project-files-list">
        {loading && <div className="project-files-empty">{t('Caricamento file…')}</div>}
        {!loading && error && (
          <div className="project-files-error" role="alert">
            {error}
          </div>
        )}
        {!loading && !error && groups.length === 0 && (
          <div className="project-files-empty">
            {t(files.length === 0 ? 'Nessun file nel progetto.' : 'Nessun file corrispondente.')}
          </div>
        )}
        {!loading &&
          !error &&
          groups.map(([directory, directoryFiles]) => (
            <section className="project-files-group" key={directory || '__root'}>
              <div className="project-files-group-title">{directory || t('Radice')}</div>
              {directoryFiles.map((file) => (
                <button
                  type="button"
                  className="project-file-row"
                  key={file.path}
                  onClick={() => void openPreview(file)}
                  title={file.path}
                >
                  <span className={`project-file-badge is-${file.kind}`}>{fileBadge(file)}</span>
                  <span className="project-file-name">{file.name}</span>
                  <span className="project-file-size">{formatSize(file.size)}</span>
                </button>
              ))}
            </section>
          ))}
      </div>
      <footer className="project-files-footer">
        {t('{count} file · {id}', { count: files.length, id: project.id })}
      </footer>
    </div>
  );
}
