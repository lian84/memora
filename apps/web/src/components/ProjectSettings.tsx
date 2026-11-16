import { useCallback, useEffect, useState } from 'react';
import type { ProjectRecord } from '@memora/shared';
import {
  createProjectSource,
  deleteProjectSource,
  exportProject,
  getProjectSource,
  listProjectSources,
  updateProject,
  updateProjectSource,
  type MemorySource,
} from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { ConfirmDialog } from './ConfirmDialog';

interface ProjectSettingsProps {
  project: ProjectRecord;
  onClose: () => void;
  onSaved: (project: ProjectRecord) => void;
  onSourcesChanged: () => void;
  onRequestDelete?: (project: ProjectRecord) => void;
}

export function ProjectSettings({ project, onClose, onSaved, onSourcesChanged, onRequestDelete }: ProjectSettingsProps) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [prompt, setPrompt] = useState(project.prompt);
  const [includeGlobal, setIncludeGlobal] = useState(project.retrieval.includeGlobal);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sources, setSources] = useState<MemorySource[]>([]);
  const [source, setSource] = useState<MemorySource | null>(null);
  const [sourceContent, setSourceContent] = useState('');
  const [sourceSaving, setSourceSaving] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sourceDeleteOpen, setSourceDeleteOpen] = useState(false);
  const [sourceDeleteError, setSourceDeleteError] = useState<string | null>(null);
  const [newPath, setNewPath] = useState(`projects/${project.id}/sources/`);
  const [newContent, setNewContent] = useState('# Nuova fonte\n\n');

  const loadSources = useCallback(async () => {
    try {
      setSources(await listProjectSources(project.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [project.id]);

  useEffect(() => { void loadSources(); }, [loadSources]);

  const saveProject = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateProject(project.id, {
        name: name.trim(),
        description: description.trim(),
        prompt,
        retrieval: { ...project.retrieval, includeGlobal },
      });
      onSaved(updated);
      setMessage('Progetto salvato.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProject(project.id, { status: project.status === 'active' ? 'archived' : 'active' });
      onSaved(updated);
      setMessage(updated.status === 'archived' ? 'Progetto archiviato.' : 'Progetto riattivato.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const downloadExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const data = await exportProject(project.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${project.id}-export.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage('Export pronto.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const openSource = async (item: MemorySource) => {
    setSource(item);
    setError(null);
    try {
      const detail = await getProjectSource(project.id, item.id);
      setSourceContent(detail.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveSource = async () => {
    if (!source) return;
    setSourceSaving(true);
    setError(null);
    try {
      await updateProjectSource(project.id, source.id, sourceContent);
      await loadSources();
      onSourcesChanged();
      setMessage('Fonte aggiornata.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSourceSaving(false);
    }
  };

  const loadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.(md|txt)$/i.test(file.name)) {
      setError('Sono supportati solo file .md e .txt.');
      return;
    }
    setFileLoading(true);
    setError(null);
    try {
      const text = await file.text();
      setNewPath(`projects/${project.id}/sources/${file.name}`);
      setNewContent(text);
      setMessage(`File ${file.name} caricato: controlla e crea la fonte.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFileLoading(false);
    }
  };

  const createSource = async () => {
    setSourceSaving(true);
    setError(null);
    try {
      const created = await createProjectSource(project.id, newPath.trim(), newContent);
      await loadSources();
      onSourcesChanged();
      setSource(created);
      setSourceContent(created.content);
      setNewPath(`projects/${project.id}/sources/`);
      setNewContent('# Nuova fonte\n\n');
      setMessage('Fonte creata.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSourceSaving(false);
    }
  };

  const removeSource = async () => {
    if (!source) return;
    setSourceSaving(true);
    setSourceDeleteError(null);
    setError(null);
    try {
      await deleteProjectSource(project.id, source.id);
      setSourceDeleteOpen(false);
      setSource(null);
      setSourceContent('');
      await loadSources();
      onSourcesChanged();
      setMessage('Fonte eliminata.');
    } catch (err) {
      setSourceDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setSourceSaving(false);
    }
  };

  return (
    <section className="project-settings" aria-label={`Progetto ${project.name}`}>
      <div className="project-settings-header">
        <div>
          <span className="admin-eyebrow">Progetto</span>
          <h2>{project.name}</h2>
          <p><code>{project.id}</code> · {project.status} · {project.source === 'legacy' ? 'legacy' : 'project.json'}</p>
        </div>
        <div className="project-header-actions">
          <span className={`project-status is-${project.status}`}>{project.status === 'active' ? 'attivo' : 'archiviato'}</span>
          <button type="button" onClick={() => void downloadExport()} disabled={exporting}>{exporting ? 'Esporto…' : 'Esporta JSON'}</button>
          <button type="button" onClick={() => void toggleArchive()} disabled={saving}>{project.status === 'active' ? 'Archivia' : 'Riattiva'}</button>
          <button type="button" className="admin-close" onClick={onClose}>Torna alla chat</button>
        </div>
      </div>

      {error && <div className="admin-alert is-error" role="alert">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}

      <section className="admin-card">
        <h3>Profilo e prompt</h3>
        <label className="admin-label">Nome
          <input value={name} onChange={event => setName(event.target.value)} />
        </label>
        <label className="admin-label">Descrizione
          <textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} />
        </label>
        <label className="admin-label">Prompt di progetto
          <textarea rows={6} value={prompt} onChange={event => setPrompt(event.target.value)} />
          <small>Integra il comportamento del progetto ma non può modificare policy, permessi o strumenti.</small>
        </label>
        <label className="admin-toggle">
          <input type="checkbox" checked={includeGlobal} onChange={event => setIncludeGlobal(event.target.checked)} />
          <span>Includi la memoria globale nelle chat del progetto</span>
        </label>
        <div className="admin-actions">
          <button type="button" className="admin-primary" onClick={() => void saveProject()} disabled={saving}>{saving ? 'Salvo…' : 'Salva progetto'}</button>
        </div>
      </section>

      <section className="admin-card">
        <h3>Fonti del progetto</h3>
        <div className="project-sources-layout">
          <div className="project-source-list">
            {sources.length === 0 && <div className="second-brain-empty">Nessuna fonte.</div>}
            {sources.map(item => (
              <button type="button" key={item.id} className={`project-source-item${source?.id === item.id ? ' is-selected' : ''}`} onClick={() => void openSource(item)}>
                <strong>{item.relativePath}</strong>
                <span>{item.chunkCount} chunk</span>
              </button>
            ))}
          </div>
          <div className="project-source-editor">
            {source ? (
              <>
                <div className="project-source-editor-title">
                  <strong>{source.relativePath}</strong>
                  <button type="button" className="memory-action-danger" onClick={() => { setSourceDeleteError(null); setSourceDeleteOpen(true); }} disabled={sourceSaving}>Elimina</button>
                </div>
                <textarea rows={12} value={sourceContent} onChange={event => setSourceContent(event.target.value)} spellCheck={false} />
                <div className="admin-actions">
                  <button type="button" className="admin-primary" onClick={() => void saveSource()} disabled={sourceSaving}>{sourceSaving ? 'Salvo…' : 'Salva fonte'}</button>
                  <button type="button" onClick={() => { setSource(null); setSourceContent(''); }} disabled={sourceSaving}>Chiudi</button>
                </div>
                <details className="project-source-preview">
                  <summary>Anteprima</summary>
                  <div className="source-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(sourceContent) }} />
                </details>
              </>
            ) : (
              <>
                <label className="admin-label">Percorso nuova fonte
                  <input value={newPath} onChange={event => setNewPath(event.target.value)} />
                </label>
                <label className="project-file-upload">
                  <span>{fileLoading ? 'Leggo il file…' : 'Carica file .md o .txt'}</span>
                  <input type="file" accept=".md,.txt,text/markdown,text/plain" onChange={event => void loadFile(event)} disabled={fileLoading || sourceSaving} />
                </label>
                <label className="admin-label">Contenuto Markdown
                  <textarea rows={8} value={newContent} onChange={event => setNewContent(event.target.value)} spellCheck={false} />
                </label>
                <div className="admin-actions">
                  <button type="button" className="admin-primary" onClick={() => void createSource()} disabled={sourceSaving || !newPath.trim()}>{sourceSaving ? 'Creo…' : 'Crea fonte'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {onRequestDelete && (
        <section className="admin-card project-danger-zone">
          <h3>Zona pericolosa</h3>
          <p>Il progetto, le sue fonti e i file verranno spostati nel cestino di Memora. Le chat esistenti non vengono cancellate.</p>
          <button type="button" className="memory-action-danger" onClick={() => onRequestDelete(project)}>Elimina progetto</button>
        </section>
      )}

      {sourceDeleteOpen && source && (
        <ConfirmDialog
          title={`Eliminare “${source.relativePath}”?`}
          confirmLabel="Elimina fonte"
          busy={sourceSaving}
          error={sourceDeleteError}
          onClose={() => { setSourceDeleteOpen(false); setSourceDeleteError(null); }}
          onConfirm={() => void removeSource()}
        >
          <p>La fonte verrà rimossa dal progetto e dall’indice di retrieval.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
