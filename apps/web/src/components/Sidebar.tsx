import { useCallback, useState } from 'react';
import type { SessionInfo } from '../lib/api';
import type { ProjectRecord } from '@memora/shared';
import { ProjectPicker } from './ProjectPicker';
import { useI18n } from '../i18n';

interface SidebarProps {
  sessions: SessionInfo[];
  onSelect: (sessionId: string) => void;
  onCreate: () => Promise<unknown>;
  onRename: (sessionId: string, name: string) => Promise<void>;
  onArchive: (sessionId: string, archived: boolean) => Promise<void>;
  onDelete: (sessionId: string) => Promise<void>;
  selectedSessionId: string | null;
  loading: boolean;
  error: string | null;
  archivedView: boolean;
  onToggleArchivedView: () => void;
  /** Drawer aperto su viewport mobile. */
  mobileOpen?: boolean;
  onClose?: () => void;
  onOpenSettings?: () => void;
  settingsActive?: boolean;
  projects?: ProjectRecord[];
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string | null) => void;
  onEditProject?: (projectId: string) => void;
  onDeleteProject?: (project: ProjectRecord) => void;
  onNewProject?: () => void;
  projectSettingsActive?: boolean;
  onOpenSecondBrain?: () => void;
  secondBrainActive?: boolean;
  onLogout?: () => void;
  collapsed?: boolean;
}

type IconName = 'rename' | 'archive' | 'restore' | 'delete';

function SessionIcon({ name }: { name: IconName }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (name === 'rename') {
    return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
  }
  if (name === 'archive') {
    return <svg {...common}><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>;
  }
  if (name === 'restore') {
    return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></svg>;
  }
  return <svg {...common}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 15H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>;
}

export function Sidebar({
  sessions,
  onSelect,
  onCreate,
  onRename,
  onArchive,
  onDelete,
  selectedSessionId,
  loading,
  error,
  archivedView,
  onToggleArchivedView,
  mobileOpen = false,
  onClose,
  onOpenSettings,
  settingsActive = false,
  projects = [],
  selectedProjectId = null,
  onSelectProject,
  onEditProject,
  onDeleteProject,
  onNewProject,
  projectSettingsActive = false,
  onOpenSecondBrain,
  secondBrainActive = false,
  onLogout,
  collapsed = false,
}: SidebarProps) {
  const { t } = useI18n();
  const [renameInput, setRenameInput] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    await onCreate();
  }, [onCreate]);

  const handleToggleView = useCallback(() => {
    onToggleArchivedView();
    setRenameInput(null);
    setRenameValue('');
  }, [onToggleArchivedView]);

  const handleRenameClick = useCallback((sessionId: string, currentName: string) => {
    if (renameInput === sessionId) {
      setRenameInput(null);
      setRenameValue('');
    } else {
      setRenameInput(sessionId);
      setRenameValue(currentName);
    }
  }, [renameInput]);

  const handleRenameSubmit = useCallback(async (sessionId: string) => {
    if (!renameValue.trim()) {
      setRenameInput(null);
      setRenameValue('');
      return;
    }

    try {
      await onRename(sessionId, renameValue.trim());
      setRenameInput(null);
      setRenameValue('');
    } catch {
      // useSessions espone l'errore nella sidebar; mantieni il campo aperto.
    }
  }, [onRename, renameValue]);

  const handleArchive = useCallback((sessionId: string, archived: boolean) => {
    void onArchive(sessionId, archived).catch(() => undefined);
    setRenameInput(null);
    setRenameValue('');
  }, [onArchive]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget || deletingSessionId) return;

    const sessionId = deleteTarget.sessionId;
    setDeletingSessionId(sessionId);
    try {
      // Il dialog si chiude solo dopo un DELETE valido. In caso di errore
      // onDelete aggiorna error e la sessione resta visibile.
      await onDelete(sessionId);
      setDeleteTarget(null);
    } catch {
      // L'errore leggibile è mostrato sia nella sidebar sia nel dialog.
    } finally {
      setDeletingSessionId(null);
    }
  }, [deleteTarget, deletingSessionId, onDelete]);

  const displayTitle = (session: SessionInfo) =>
    session.draft ? 'Nuova chat' : session.name ?? session.firstMessage ?? '(nessun messaggio)';
  const archiveViewLabel = t(archivedView ? 'Torna alle chat attive' : 'Mostra chat archiviate');
  const archiveViewTitle = t(archivedView ? 'Torna alle chat attive' : 'Chat archiviate');

  return (
    <aside className={`sidebar${mobileOpen ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`} aria-label={t('Barra chat e sessioni')}>
      <header className="sidebar-header">
        <div>
          <h1>{t('Memora')}</h1>
          <p>{t('Chat &amp; Sessioni')}</p>
        </div>
        {onClose && (
          <button type="button" className="sidebar-close" aria-label={t('Chiudi pannello sessioni')} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </header>
      {onSelectProject && (
        <ProjectPicker
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelect={onSelectProject}
          onNew={() => onNewProject?.()}
          onEdit={projectId => onEditProject?.(projectId)}
          onDelete={project => onDeleteProject?.(project)}
          settingsActive={projectSettingsActive}
        />
      )}
      <div className="sidebar-toolbar">
        <button type="button" className="new-chat-button" onClick={handleCreate} disabled={loading}>{t('Nuova chat')}</button>
        <button
          type="button"
          className={`archive-view-button${archivedView ? ' is-active' : ''}`}
          aria-label={archiveViewLabel}
          aria-pressed={archivedView}
          title={archiveViewTitle}
          onClick={handleToggleView}
        >
          <SessionIcon name="archive" />
        </button>
      </div>
      {error && <div role="alert" className="sidebar-error">{error}</div>}
      <div className="session-list">
        {loading && sessions.length === 0 && <div className="session-list-empty">{t('Caricamento sessioni...')}</div>}
        {!loading && sessions.length === 0 && <div className="session-list-empty">{t(archivedView ? 'Nessuna sessione archiviata.' : 'Nessuna sessione. Clicca “Nuova chat” per iniziare.')}</div>}
        {sessions.map((session) => {
          const isSelected = selectedSessionId === session.sessionId;
          const isRenaming = renameInput === session.sessionId;
          const title = displayTitle(session);
          return (
            <div
              key={session.sessionId}
              className={`session-row${isSelected ? ' is-selected' : ''}${isRenaming ? ' is-renaming' : ''}`}
              onClick={() => { if (!isRenaming) onSelect(session.sessionId); }}
              title={title}
            >
              {isRenaming ? (
                <input
                  className="session-rename-input"
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleRenameSubmit(session.sessionId);
                    if (event.key === 'Escape') { setRenameInput(null); setRenameValue(''); }
                  }}
                  onBlur={() => void handleRenameSubmit(session.sessionId)}
                />
              ) : (
                <>
                  <span className="session-title">{title}</span>
                  <span className="session-actions" aria-label={t('Azioni sessione')}>
                    {!session.draft && (
                      <button
                        type="button"
                        className="session-action-button"
                        aria-label={`Rinomina ${title}`}
                        title={t('Rinomina')}
                        onClick={(event) => { event.stopPropagation(); handleRenameClick(session.sessionId, title); }}
                      >
                        <SessionIcon name="rename" />
                      </button>
                    )}
                    {!session.draft && (
                      <button
                        type="button"
                        className="session-action-button"
                        aria-label={session.archived ? `Ripristina ${title}` : `Archivia ${title}`}
                        title={t(session.archived ? 'Ripristina' : 'Archivia')}
                        onClick={(event) => { event.stopPropagation(); handleArchive(session.sessionId, !session.archived); }}
                      >
                        <SessionIcon name={session.archived ? 'restore' : 'archive'} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="session-action-button session-action-danger"
                      aria-label={`Elimina definitivamente ${title}`}
                      title={t('Elimina definitivamente')}
                      onClick={(event) => { event.stopPropagation(); setDeleteTarget(session); }}
                    >
                      <SessionIcon name="delete" />
                    </button>
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
      {(onOpenSecondBrain || onOpenSettings) && (
        <div className="sidebar-footer-actions">
          {onOpenSecondBrain && (
            <button
              type="button"
              className={`sidebar-settings sidebar-icon-button${secondBrainActive ? ' is-active' : ''}`}
              aria-current={secondBrainActive ? 'page' : undefined}
              title={t('Second Brain')}
              aria-label={t('Second Brain')}
              onClick={onOpenSecondBrain}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9.5 4.5a3 3 0 0 0-5 2.2 3.3 3.3 0 0 0-1 5.8 3.4 3.4 0 0 0 1.2 5.3A3 3 0 0 0 9.5 21a3 3 0 0 0 2.5-1.4V5.9a2.6 2.6 0 0 0-2.5-1.4Z" />
                <path d="M14.5 4.5a3 3 0 0 1 5 2.2 3.3 3.3 0 0 1 1 5.8 3.4 3.4 0 0 1-1.2 5.3A3 3 0 0 1 14.5 21a3 3 0 0 1-2.5-1.4V5.9a2.6 2.6 0 0 1 2.5-1.4Z" />
                <path d="M7 9.5h2M15 9.5h2M7 14.5h2M15 14.5h2" />
              </svg>
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              className={`sidebar-settings sidebar-icon-button${settingsActive ? ' is-active' : ''}`}
              aria-current={settingsActive ? 'page' : undefined}
              title={t('Impostazioni')}
              aria-label={t('Impostazioni')}
              onClick={onOpenSettings}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.1A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.1A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.16 4.1l.06.06A1.7 1.7 0 0 0 9.1 4.5a1.7 1.7 0 0 0 1.03-1.56V3h4v.1A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.5 9.1a1.7 1.7 0 0 0 1.56 1.03H21v4h-.1A1.7 1.7 0 0 0 19.4 15Z" />
              </svg>
            </button>
          )}
          {onLogout && (
            <button
              type="button"
              className="sidebar-settings sidebar-icon-button"
              title={t('Esci da Memora')}
              aria-label={t('Esci da Memora')}
              onClick={onLogout}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              </svg>
            </button>
          )}
        </div>
      )}
      {deleteTarget && (
        <div
          role="presentation"
          className="dialog-backdrop"
          onClick={() => { if (!deletingSessionId) setDeleteTarget(null); }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="delete-session-title" className="delete-dialog" onClick={(event) => event.stopPropagation()}>
            <h2 id="delete-session-title">{t('Eliminare definitivamente questa chat?')}</h2>
            <p>{t('Questa operazione non può essere annullata.')}</p>
            {error && <p role="alert" className="delete-dialog-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={Boolean(deletingSessionId)}>{t('Annulla')}</button>
              <button type="button" autoFocus className="delete-confirm-button" onClick={() => void handleDeleteConfirm()} disabled={Boolean(deletingSessionId)}>
                {deletingSessionId ? t('Eliminazione…') : t('Elimina definitivamente')}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
