import { useCallback, useEffect, useState } from 'react';
import { MCP_SERVER_DEFINITIONS, type McpAccount, type McpServerId, type ProjectIcon, type ProjectRecord, type ProjectSection } from '@memora/shared';
import {
  createMcpAccount,
  createProjectSource,
  deleteProjectSource,
  listMcpAccounts,
  exportProject,
  getProjectSource,
  listProjectSources,
  updateProject,
  updateProjectSource,
  type MemorySource,
} from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { ConfirmDialog } from './ConfirmDialog';
import { useI18n } from '../i18n';
import { IconPicker } from './IconPicker';

interface ProjectSettingsProps {
  project: ProjectRecord;
  onClose: () => void;
  onSaved: (project: ProjectRecord) => void;
  onSourcesChanged: () => void;
  onRequestDelete?: (project: ProjectRecord) => void;
  sections?: ProjectSection[];
}

export function ProjectSettings({ project, onClose, onSaved, onSourcesChanged, onRequestDelete, sections = [] }: ProjectSettingsProps) {
  const { t } = useI18n();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [prompt, setPrompt] = useState(project.prompt);
  const [sectionId, setSectionId] = useState(project.sectionId ?? '');
  const [icon, setIcon] = useState<ProjectIcon>(project.icon ?? 'folder');
  const [includeGlobal, setIncludeGlobal] = useState(project.retrieval.includeGlobal);
  const [showArchivedSessions, setShowArchivedSessions] = useState(project.showArchivedSessions === true);
  const [mcpAccounts, setMcpAccounts] = useState<Partial<Record<McpServerId, string>>>(project.mcpAccounts ?? {});
  const [availableMcpAccounts, setAvailableMcpAccounts] = useState<McpAccount[]>([]);
  const [mcpAccountForm, setMcpAccountForm] = useState<{ serverId: McpServerId | null; label: string; token: string }>({ serverId: null, label: '', token: '' });
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

  useEffect(() => {
    void listMcpAccounts(project.id).then(setAvailableMcpAccounts).catch(() => setAvailableMcpAccounts([]));
  }, [project.id]);

  const saveProject = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateProject(project.id, {
        name: name.trim(),
        description: description.trim(),
        prompt,
        sectionId: sectionId || null,
        icon,
        showArchivedSessions,
        mcpAccounts,
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

  const setServerAccount = (serverId: McpServerId, accountId: string) => {
    setMcpAccounts(current => {
      const next = { ...current };
      if (accountId) next[serverId] = accountId; else delete next[serverId];
      return next;
    });
  };

  const createProjectMcpAccount = async () => {
    if (!mcpAccountForm.serverId || !mcpAccountForm.label.trim() || !mcpAccountForm.token.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const account = await createMcpAccount({
        serverId: mcpAccountForm.serverId,
        scope: 'project',
        projectId: project.id,
        label: mcpAccountForm.label.trim(),
        token: mcpAccountForm.token.trim(),
        defaultForServer: false,
      });
      setAvailableMcpAccounts(current => [...current, account]);
      setMcpAccounts(current => ({ ...current, [account.serverId]: account.id }));
      setMcpAccountForm({ serverId: null, label: '', token: '' });
      setMessage(t('Account MCP di progetto creato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="project-settings" aria-label={`${t('Progetto')} ${project.name}`}>
      <div className="project-settings-header">
        <div>
          <span className="admin-eyebrow">{t('Progetto')}</span>
          <h2>{project.name}</h2>
          <p><code>{project.id}</code> · {project.status} · {project.source === 'legacy' ? 'legacy' : 'project.json'}</p>
        </div>
        <div className="project-header-actions">
          <span className={`project-status is-${project.status}`}>{t(project.status === 'active' ? 'attivo' : 'archiviato')}</span>
          <button type="button" onClick={() => void downloadExport()} disabled={exporting}>{exporting ? t('Esporto…') : t('Esporta JSON')}</button>
          <button type="button" onClick={() => void toggleArchive()} disabled={saving}>{t(project.status === 'active' ? 'Archivia' : 'Riattiva')}</button>
          <button type="button" className="admin-close" onClick={onClose}>{t('Torna alla chat')}</button>
        </div>
      </div>

      {error && <div className="admin-alert is-error" role="alert">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}

      <section className="admin-card">
        <h3>{t('Profilo e prompt')}</h3>
        <label className="admin-label">{t('Nome')}
          <input value={name} onChange={event => setName(event.target.value)} />
        </label>
        <label className="admin-label">{t('Descrizione')}
          <textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} />
        </label>
        <label className="admin-label">{t('Sezione')}
          <select value={sectionId} onChange={event => setSectionId(event.target.value)}>
            <option value="">{t('Senza sezione')}</option>
            {sections.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}
          </select>
        </label>
        <label className="admin-label">{t('Icona')}
          <IconPicker value={icon} onChange={setIcon} />
        </label>
        <label className="admin-label">{t('Prompt di progetto')}
          <textarea rows={6} value={prompt} onChange={event => setPrompt(event.target.value)} />
          <small>{t('Integra il comportamento del progetto ma non può modificare policy, permessi o strumenti.')}</small>
        </label>
        <label className="admin-toggle">
          <input type="checkbox" checked={includeGlobal} onChange={event => setIncludeGlobal(event.target.checked)} />
          <span>{t('Includi la memoria globale nelle chat del progetto')}</span>
        </label>
        <label className="admin-toggle">
          <input type="checkbox" checked={showArchivedSessions} onChange={event => setShowArchivedSessions(event.target.checked)} />
          <span>{t('Mostra le chat archiviate di questo progetto')}</span>
        </label>
        <div className="admin-actions">
          <button type="button" className="admin-primary" onClick={() => void saveProject()} disabled={saving}>{saving ? t('Salvo…') : t('Salva progetto')}</button>
        </div>
      </section>

      <section className="admin-card">
        <h3>{t('Account MCP del progetto')}</h3>
        <p className="admin-card-description">{t('Scegli un account globale oppure crea un account dedicato a questo progetto. I token restano nel secret store.')}</p>
        {MCP_SERVER_DEFINITIONS.map(server => {
          const accounts = availableMcpAccounts.filter(account => account.serverId === server.id);
          const globalAccounts = accounts.filter(account => account.scope === 'global');
          const projectAccounts = accounts.filter(account => account.scope === 'project' && account.projectId === project.id);
          return (
            <div className="project-mcp-row" key={server.id}>
              <label className="admin-label">{server.label}
                <select value={mcpAccounts[server.id] ?? ''} onChange={event => setServerAccount(server.id, event.target.value)}>
                  <option value="">{t('Usa il predefinito globale')}</option>
                  {globalAccounts.length > 0 && <optgroup label={t('Globali')}>
                    {globalAccounts.map(account => <option key={account.id} value={account.id}>{account.label}{account.defaultForServer ? ` · ${t('predefinito')}` : ''}</option>)}
                  </optgroup>}
                  {projectAccounts.length > 0 && <optgroup label={t('Di questo progetto')}>
                    {projectAccounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
                  </optgroup>}
                </select>
              </label>
              <button type="button" className="admin-link-button" onClick={() => setMcpAccountForm({ serverId: server.id, label: '', token: '' })}>{t('+ Account progetto')}</button>
            </div>
          );
        })}
        {mcpAccountForm.serverId && (
          <div className="project-mcp-new">
            <h4>{t('Nuovo account progetto per {server}', { server: MCP_SERVER_DEFINITIONS.find(server => server.id === mcpAccountForm.serverId)?.label ?? '' })}</h4>
            <div className="project-mcp-form-grid">
              <label className="admin-label">{t('Nome account')}
                <input value={mcpAccountForm.label} onChange={event => setMcpAccountForm(current => ({ ...current, label: event.target.value }))} placeholder="Orione lavoro" maxLength={120} />
              </label>
              <label className="admin-label">{t('Token')}
                <input type="password" value={mcpAccountForm.token} onChange={event => setMcpAccountForm(current => ({ ...current, token: event.target.value }))} placeholder="ntn_..." autoComplete="new-password" spellCheck={false} />
                <small>{t('Salvato nel secret store locale, non nel progetto.')}</small>
              </label>
            </div>
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={() => void createProjectMcpAccount()} disabled={saving}>{t('Crea account progetto')}</button>
              <button type="button" onClick={() => setMcpAccountForm({ serverId: null, label: '', token: '' })}>{t('Annulla')}</button>
            </div>
          </div>
        )}
      </section>

      <section className="admin-card">
        <h3>{t('Fonti del progetto')}</h3>
        <div className="project-sources-layout">
          <div className="project-source-list">
            {sources.length === 0 && <div className="second-brain-empty">{t('Nessuna fonte.')}</div>}
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
                  <button type="button" className="memory-action-danger" onClick={() => { setSourceDeleteError(null); setSourceDeleteOpen(true); }} disabled={sourceSaving}>{t('Elimina')}</button>
                </div>
                <textarea rows={12} value={sourceContent} onChange={event => setSourceContent(event.target.value)} spellCheck={false} />
                <div className="admin-actions">
                  <button type="button" className="admin-primary" onClick={() => void saveSource()} disabled={sourceSaving}>{sourceSaving ? t('Salvo…') : t('Salva fonte')}</button>
                  <button type="button" onClick={() => { setSource(null); setSourceContent(''); }} disabled={sourceSaving}>{t('Chiudi')}</button>
                </div>
                <details className="project-source-preview">
                  <summary>{t('Anteprima')}</summary>
                  <div className="source-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(sourceContent) }} />
                </details>
              </>
            ) : (
              <>
                <label className="admin-label">{t('Percorso nuova fonte')}
                  <input value={newPath} onChange={event => setNewPath(event.target.value)} />
                </label>
                <label className="project-file-upload">
                  <span>{fileLoading ? t('Leggo il file…') : t('Carica file .md o .txt')}</span>
                  <input type="file" accept=".md,.txt,text/markdown,text/plain" onChange={event => void loadFile(event)} disabled={fileLoading || sourceSaving} />
                </label>
                <label className="admin-label">{t('Contenuto Markdown')}
                  <textarea rows={8} value={newContent} onChange={event => setNewContent(event.target.value)} spellCheck={false} />
                </label>
                <div className="admin-actions">
                  <button type="button" className="admin-primary" onClick={() => void createSource()} disabled={sourceSaving || !newPath.trim()}>{sourceSaving ? t('Creo…') : t('Crea fonte')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {onRequestDelete && (
        <section className="admin-card project-danger-zone">
          <h3>{t('Zona pericolosa')}</h3>
          <p>{t('Il progetto, le sue fonti e i file verranno spostati nel cestino di Memora. Le chat esistenti non vengono cancellate.')}</p>
          <button type="button" className="memory-action-danger" onClick={() => onRequestDelete(project)}>{t('Elimina progetto')}</button>
        </section>
      )}

      {sourceDeleteOpen && source && (
        <ConfirmDialog
          title={`Eliminare “${source.relativePath}”?`}
          confirmLabel={t('Elimina fonte')}
          busy={sourceSaving}
          error={sourceDeleteError}
          onClose={() => { setSourceDeleteOpen(false); setSourceDeleteError(null); }}
          onConfirm={() => void removeSource()}
        >
          <p>{t('La fonte verrà rimossa dal progetto e dall’indice di retrieval.')}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
