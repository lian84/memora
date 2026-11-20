import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Chat, appendOptimisticTurn, updateStreamingPlaceholder, type DisplayChatMessage } from './components/Chat';
import { ModelSelector } from './components/ModelSelector';
import { ReasoningSelector } from './components/ReasoningSelector';
import { SecondBrainPage } from './components/SecondBrainPage';
import { ChatMemoryPanel } from './components/ChatMemoryPanel';
import { AdminSettings } from './components/AdminSettings';
import { ProjectSettings } from './components/ProjectSettings';
import { NewProjectDialog } from './components/NewProjectDialog';
import { ProjectDeleteDialog } from './components/ProjectDeleteDialog';
import { SectionDialog } from './components/SectionDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { useAuth } from './components/AuthGate';
import { useI18n } from './i18n';
import { useSessions } from './hooks/useSessions';
import { clearStoredModelSelection, readStoredModelSelection, saveStoredModelSelection } from './hooks/useModels';
import { selectedSessionAfterDelete } from './lib/selectionState';
import { deleteProjectSection, getAdminStatus, listAgentProfiles, listProjectSections, listProjects, listTurnReads, listTurns, markTurnRead as markTurnReadApi, setSessionReasoningLevel, type TurnInfo } from './lib/api';
import { initAppearance, updateAppearance, useAppearance } from './lib/appearance';
import { notifyTurnFinished } from './lib/browser-notifications';
import type { AgentProfileSummary, ChatAttachment, ProjectRecord, ProjectSection, ProviderId, ReasoningLevel } from '@memora/shared';

const SESSION_STORAGE_KEY = 'memora-selected-session';
const PROJECT_STORAGE_KEY = 'memora-selected-project';
const TURN_READ_KEY = 'memora-read-turns';

function readTurnReadMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(TURN_READ_KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, turnId]) => typeof turnId === 'string'))
      : {};
  } catch {
    return {};
  }
}

function persistTurnReadMap(value: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(TURN_READ_KEY, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
}

function getSessionFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('session') || null;
}

function setSessionInUrl(sessionId: string | null): void {
  if (typeof window === 'undefined' || !window.history) return;
  const params = new URLSearchParams(window.location.search);
  if (sessionId) {
    params.set('session', sessionId);
  } else {
    params.delete('session');
  }
  window.history.replaceState(
    {},
    '',
    `${window.location.pathname}?${params.toString()}${window.location.hash}`,
  );
}

export default function App() {
  const {
    sessions,
    loading,
    error,
    load,
    create,
    getMessages,
    resume,
    rename,
    archive,
    remove,
  } = useSessions();
  const storedSelection = readStoredModelSelection();
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const handleSelectSessionRef = useRef<(sessionId: string) => void>(() => undefined);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(storedSelection?.provider ?? 'openrouter');
  const [selectedModelId, setSelectedModelId] = useState<string>(storedSelection?.modelId ?? '');
  const [selectedReasoningLevel, setSelectedReasoningLevel] = useState<ReasoningLevel>(storedSelection?.reasoningLevel ?? 'medium');
  const [messages, setMessages] = useState<DisplayChatMessage[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [memoryRevision, setMemoryRevision] = useState(0);
  const [adminOpen, setAdminOpen] = useState(false);
  const [secondBrainOpen, setSecondBrainOpen] = useState(false);
  const [secondBrainScope, setSecondBrainScope] = useState('all');
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfileSummary[]>([]);
  const [sections, setSections] = useState<ProjectSection[]>([]);
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [sectionEditTarget, setSectionEditTarget] = useState<ProjectSection | null>(null);
  const [sectionDeleteTarget, setSectionDeleteTarget] = useState<ProjectSection | null>(null);
  const [sectionDeleteBusy, setSectionDeleteBusy] = useState(false);
  const [sectionDeleteError, setSectionDeleteError] = useState<string | null>(null);
  const [newProjectSectionId, setNewProjectSectionId] = useState<string | null>(null);
  const [turnsBySession, setTurnsBySession] = useState<Record<string, TurnInfo>>({});
  const [turnReadRevision, setTurnReadRevision] = useState(0);
  const turnReadRef = useRef<Record<string, string>>(readTurnReadMap());
  const previousTurnsRef = useRef<Record<string, TurnInfo>>({});
  const lastPollAtRef = useRef<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => typeof window === 'undefined' ? null : localStorage.getItem(PROJECT_STORAGE_KEY));
  const [projectOpen, setProjectOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [projectDeleteTarget, setProjectDeleteTarget] = useState<ProjectRecord | null>(null);
  const explicitModelSelection = useRef(false);
  const appearance = useAppearance();
  const { logout } = useAuth();
  const { t } = useI18n();

  useEffect(() => { initAppearance(); }, []);

  useEffect(() => {
    const refreshAgentProfiles = () => {
      void listAgentProfiles().then(setAgentProfiles).catch(() => setAgentProfiles([]));
      // I metadati visivi delle sessioni (icona/nome/colore) sono risolti dal
      // profilo corrente; ricarica la lista per aggiornare le chat esistenti.
      void load();
    };
    refreshAgentProfiles();
    window.addEventListener('memora-agent-profiles-changed', refreshAgentProfiles);
    return () => window.removeEventListener('memora-agent-profiles-changed', refreshAgentProfiles);
  }, [load]);

  useEffect(() => {
    void getAdminStatus()
      .then((status) => {
        setSelectedProvider(status.chat.provider);
        if (explicitModelSelection.current) return;
        const stored = readStoredModelSelection();
        if (stored && stored.provider === status.chat.provider) {
          setSelectedModelId(stored.modelId);
          setSelectedReasoningLevel(stored.reasoningLevel);
        } else {
          clearStoredModelSelection();
          setSelectedModelId(status.chat.model);
          setSelectedReasoningLevel(status.chat.reasoningLevel);
        }
      })
      .catch(() => undefined);
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const next = await listProjects();
      setProjects(next);
      setSelectedProjectId(current => {
        if (current && !next.some(project => project.id === current)) {
          localStorage.removeItem(PROJECT_STORAGE_KEY);
          return null;
        }
        return current;
      });
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  const loadProjectSections = useCallback(async () => {
    try { setSections(await listProjectSections()); }
    catch { setSections([]); }
  }, []);

  useEffect(() => { void loadProjectSections(); }, [loadProjectSections]);


  useEffect(() => {
    const onDefaultChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ model: string; provider: ProviderId; reasoningLevel: ReasoningLevel }>).detail;
      if (!detail?.model || !detail.provider) return;
      clearStoredModelSelection();
      explicitModelSelection.current = true;
      setSelectedProvider(detail.provider);
      setSelectedModelId(detail.model);
      setSelectedReasoningLevel(detail.reasoningLevel ?? 'medium');
    };
    window.addEventListener('memora-chat-default-changed', onDefaultChanged);
    return () => window.removeEventListener('memora-chat-default-changed', onDefaultChanged);
  }, []);

  const selectedProject = projects.find(project => project.id === selectedProjectId) ?? null;
  const selectedSession = sessions.find((session) => session.sessionId === selectedSessionId);
  const visibleSessions = useMemo(() => sessions.filter(session => {
    if (!session.archived) return true;
    if (!session.projectId) return true;
    return projects.find(project => project.id === session.projectId)?.showArchivedSessions === true;
  }), [projects, sessions]);
  const chatProject = selectedSession?.projectId
    ? projects.find(project => project.id === selectedSession.projectId) ?? null
    : selectedProject;
  const selectedSessionTitle = adminOpen
    ? t('Amministrazione')
    : secondBrainOpen
      ? t('Second Brain')
      : projectOpen && selectedProject
      ? selectedProject.name
      : selectedSession
        ? selectedSession.draft
          ? t('Nuova chat')
          : selectedSession.name ?? selectedSession.firstMessage ?? '(nessun messaggio)'
        : selectedProject ? selectedProject.name : t('Memora');

  const markRead = useCallback((sessionId: string, turnId: string) => {
    if (turnReadRef.current[sessionId] === turnId) return;
    turnReadRef.current = { ...turnReadRef.current, [sessionId]: turnId };
    persistTurnReadMap(turnReadRef.current);
    setTurnReadRevision(value => value + 1);
    void markTurnReadApi(sessionId, turnId).catch(() => undefined);
  }, []);

  const loadMessages = useCallback(
    async (sessionId: string) => {
      const msgs = await getMessages(sessionId);
      setMessages(msgs.map((message, index) => ({ ...message, id: `history-${message.timestamp}-${index}` })));
    },
    [getMessages],
  );

  // Ripristina solo un ID realmente presente nella lista. In particolare, non
  // provare mai a fare resume/get messages di un valore stale in URL/storage.
  useEffect(() => {
    if (selectedSessionId || loading) return;
    const urlSession = getSessionFromUrl();
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    const initial = urlSession || stored || null;
    if (!initial) return;
    if (!sessions.some((session) => session.sessionId === initial)) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setSessionInUrl(null);
      setMessages([]);
      return;
    }
    setSelectedSessionId(initial);
    void loadMessages(initial);
  }, [loading, selectedSessionId, sessions, loadMessages]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const list = await listTurns();
        if (cancelled) return;
        const latest: Record<string, TurnInfo> = {};
        for (const turn of list) {
          const current = latest[turn.sessionId];
          if (!current || turn.updatedAt >= current.updatedAt) latest[turn.sessionId] = turn;
        }
        // Lo stato letto è condiviso dal server; il localStorage resta un
        // fallback se la rete è temporaneamente assente.
        let serverReads: Record<string, string> = {};
        try { serverReads = await listTurnReads(); } catch { /* usa il fallback locale */ }
        const mergedReads = { ...turnReadRef.current, ...serverReads };
        const readsChanged = Object.keys(mergedReads).some(key => turnReadRef.current[key] !== mergedReads[key]);
        if (readsChanged) {
          turnReadRef.current = mergedReads;
          persistTurnReadMap(turnReadRef.current);
          setTurnReadRevision(value => value + 1);
        }
        const previous = previousTurnsRef.current;
        setTurnsBySession(latest);
        previousTurnsRef.current = latest;
        if (selectedSessionId) {
          const selectedTurn = latest[selectedSessionId];
          const before = previous[selectedSessionId];
          if (selectedTurn && (selectedTurn.status === 'completed' || selectedTurn.status === 'failed' || selectedTurn.status === 'aborted' || selectedTurn.status === 'interrupted')) {
            if ((before?.status === 'running' || before?.status === 'queued') && before.turnId === selectedTurn.turnId) {
              void loadMessages(selectedSessionId);
            }
            markRead(selectedSessionId, selectedTurn.turnId);
          }
        }
        const pollStartedAt = lastPollAtRef.current;
        const finishedNow = Object.values(latest).filter(turn => {
          const before = previous[turn.sessionId];
          const terminal = turn.status === 'completed' || turn.status === 'failed' || turn.status === 'interrupted';
          if (!terminal) return false;
          // Al primo polling non notifichiamo la cronologia già presente.
          // Dal secondo in poi copriamo anche i turni più veloci dell'intervallo.
          return pollStartedAt === null
            ? false
            : before ? before.turnId !== turn.turnId : turn.updatedAt >= pollStartedAt;
        });
        lastPollAtRef.current = Date.now();
        for (const turn of finishedNow) {
          const session = sessionsRef.current.find(item => item.sessionId === turn.sessionId);
          notifyTurnFinished({
            sessionId: turn.sessionId,
            title: `Memo · ${session?.name || session?.firstMessage || t('Chat')}`,
            body: turn.status === 'completed'
              ? t('La risposta è pronta.')
              : turn.status === 'interrupted'
                ? t('Memora è stato riavviato durante la generazione.')
                : t('La generazione della risposta è fallita.'),
            activeSessionId: selectedSessionId,
            onOpen: () => handleSelectSessionRef.current(turn.sessionId),
          });
        }
        if (finishedNow.length > 0) void load();
      } catch {
        // Il polling dei turni non deve disturbare la chat.
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [load, loadMessages, markRead, selectedSessionId, t]);

  const turnStatuses = useMemo(() => Object.fromEntries(
    Object.values(turnsBySession).map(turn => [turn.sessionId, turn.status]),
  ), [turnsBySession]);
  const unreadSessions = useMemo(() => {
    void turnReadRevision;
    return new Set(Object.values(turnsBySession)
      .filter(turn => turn.status === 'completed' && turnReadRef.current[turn.sessionId] !== turn.turnId)
      .map(turn => turn.sessionId));
  }, [turnReadRevision, turnsBySession]);

  const handleSelectProject = useCallback((projectId: string | null) => {
    setSelectedProjectId(projectId);
    setProjectOpen(false);
    setAdminOpen(false);
    setSecondBrainOpen(false);
    if (projectId) localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
    else localStorage.removeItem(PROJECT_STORAGE_KEY);
  }, []);

  const handleOpenSecondBrain = useCallback((scope = 'all') => {
    setSecondBrainScope(scope);
    setSecondBrainOpen(true);
    setAdminOpen(false);
    setProjectOpen(false);
    setSidebarOpen(false);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
      setSidebarOpen(open => !open);
      return;
    }
    updateAppearance({ sidebarCollapsed: !appearance.sidebarCollapsed });
  }, [appearance.sidebarCollapsed]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        handleToggleSidebar();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [handleToggleSidebar]);

  const handleProjectSaved = useCallback((project: ProjectRecord) => {
    setProjects(current => current.map(item => item.id === project.id ? project : item));
    setMemoryRevision(revision => revision + 1);
  }, []);

  const handleProjectCreated = useCallback((project: ProjectRecord) => {
    setProjects(current => [...current, project].sort((a, b) => a.name.localeCompare(b.name, 'it')));
    setSelectedProjectId(project.id);
    localStorage.setItem(PROJECT_STORAGE_KEY, project.id);
    setSelectedSessionId(null);
    setMessages([]);
    setSessionInUrl(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setNewProjectOpen(false);
    setProjectOpen(true);
    setAdminOpen(false);
    setSecondBrainOpen(false);
  }, []);

  const handleEditProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
    if (selectedSession && selectedSession.projectId !== projectId) {
      setSelectedSessionId(null);
      setMessages([]);
      setSessionInUrl(null);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    setProjectOpen(true);
    setAdminOpen(false);
    setSecondBrainOpen(false);
    setSidebarOpen(false);
  }, [selectedSession]);

  const handleProjectDeleted = useCallback((projectId: string) => {
    setProjects(current => current.filter(project => project.id !== projectId));
    setProjectDeleteTarget(null);
    const sessionBelongsToProject = selectedSession?.projectId === projectId;
    if (selectedProjectId === projectId) {
      setSelectedProjectId(null);
      localStorage.removeItem(PROJECT_STORAGE_KEY);
      setProjectOpen(false);
    }
    if (selectedProjectId === projectId || sessionBelongsToProject) {
      setSelectedSessionId(null);
      setMessages([]);
      setSessionInUrl(null);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    setMemoryRevision(revision => revision + 1);
    void load();
  }, [load, selectedProjectId, selectedSession?.projectId]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      const selectedTurn = turnsBySession[sessionId];
      if (selectedTurn && (selectedTurn.status === 'completed' || selectedTurn.status === 'failed' || selectedTurn.status === 'aborted' || selectedTurn.status === 'interrupted')) {
        markRead(sessionId, selectedTurn.turnId);
      }
      setAdminOpen(false);
      setSecondBrainOpen(false);
      const sessionProjectId = sessions.find(session => session.sessionId === sessionId)?.projectId ?? null;
      setSelectedProjectId(sessionProjectId);
      if (sessionProjectId) localStorage.setItem(PROJECT_STORAGE_KEY, sessionProjectId); else localStorage.removeItem(PROJECT_STORAGE_KEY);
      setSelectedSessionId(sessionId);
      setSessionInUrl(sessionId);
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      setSidebarOpen(false);
      const result = await resume(sessionId);
      // Sincronizza il selettore con il modello persistito nella sessione,
      // senza sovrascrivere la preferenza di default in localStorage.
      if (result?.modelId) {
        explicitModelSelection.current = true;
        setSelectedModelId(result.modelId);
        if (result.reasoningLevel) setSelectedReasoningLevel(result.reasoningLevel);
      }
      await loadMessages(sessionId);
    },
    [resume, loadMessages, markRead, sessions, turnsBySession],
  );
  handleSelectSessionRef.current = handleSelectSession;

  const handleNewSession = useCallback(async (projectId?: string | null): Promise<string> => {
    const targetProjectId = projectId === undefined ? selectedProjectId : projectId;
    const result = await create(selectedModelId || undefined, selectedProvider, selectedReasoningLevel, targetProjectId ?? undefined);
    const id = result.sessionId;
    explicitModelSelection.current = true;
    if (result.modelId) setSelectedModelId(result.modelId);
    if (result.reasoningLevel) setSelectedReasoningLevel(result.reasoningLevel);
    setAdminOpen(false);
    setProjectOpen(false);
    setSecondBrainOpen(false);
    setSelectedProjectId(targetProjectId ?? null);
    if (targetProjectId) localStorage.setItem(PROJECT_STORAGE_KEY, targetProjectId); else localStorage.removeItem(PROJECT_STORAGE_KEY);
    setSelectedSessionId(id);
    setSessionInUrl(id);
    localStorage.setItem(SESSION_STORAGE_KEY, id);
    setMessages([]);
    setSidebarOpen(false);
    await load();
    return id;
  }, [create, load, selectedModelId, selectedProvider, selectedReasoningLevel, selectedProjectId]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    await remove(sessionId);
    const nextSelectedSessionId = selectedSessionAfterDelete(selectedSessionId, sessionId);
    if (nextSelectedSessionId !== selectedSessionId) {
      setSelectedSessionId(nextSelectedSessionId);
      setMessages([]);
      setSessionInUrl(null);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }

    // Difesa aggiuntiva contro un riferimento stale rimasto solo in URL o
    // localStorage, anche quando la chat aperta corrente è un'altra.
    if (getSessionFromUrl() === sessionId) setSessionInUrl(null);
    if (localStorage.getItem(SESSION_STORAGE_KEY) === sessionId) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [remove, selectedSessionId]);

  const handleNewSessionInProject = useCallback(async (projectId: string) => {
    return handleNewSession(projectId);
  }, [handleNewSession]);

  const handleNewProject = useCallback((sectionId?: string | null) => {
    setNewProjectSectionId(sectionId ?? selectedProject?.sectionId ?? null);
    setNewProjectOpen(true);
  }, [selectedProject?.sectionId]);

  const openNewSection = useCallback(() => {
    setSectionEditTarget(null);
    setSectionDialogOpen(true);
  }, []);

  const openEditSection = useCallback((section: ProjectSection) => {
    setSectionEditTarget(section);
    setSectionDialogOpen(true);
  }, []);

  const handleSectionSaved = useCallback((section: ProjectSection) => {
    setSections(current => {
      const next = current.some(item => item.id === section.id)
        ? current.map(item => item.id === section.id ? section : item)
        : [...current, section];
      return next.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'it'));
    });
    setSectionDialogOpen(false);
    setSectionEditTarget(null);
  }, []);

  const handleDeleteSection = useCallback(async () => {
    if (!sectionDeleteTarget) return;
    setSectionDeleteBusy(true);
    setSectionDeleteError(null);
    try {
      await deleteProjectSection(sectionDeleteTarget.id);
      setSections(current => current.filter(section => section.id !== sectionDeleteTarget.id));
      setSectionDeleteTarget(null);
    } catch (err) {
      setSectionDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setSectionDeleteBusy(false);
    }
  }, [sectionDeleteTarget]);

  const handleRecoverSession = useCallback(async (): Promise<string> => {
    return handleNewSession();
  }, [handleNewSession]);

  const handleStartTurn = useCallback((text: string, assistantId: string, timestamp: number, attachments: ChatAttachment[] = []) => {
    // User e placeholder assistant entrano nello stesso aggiornamento atomico e
    // conservano l'ordine conversazionale, non quello del timestamp.
    setMessages((previous) => appendOptimisticTurn(previous, text, assistantId, timestamp, attachments));
  }, []);

  const handleStreamingUpdate = useCallback((assistantId: string, content: string, streaming: boolean) => {
    setMessages((previous) => updateStreamingPlaceholder(previous, assistantId, content, streaming));
  }, []);

  const handleTurnComplete = useCallback(() => {
    // Al primo turno Pi materializza il JSONL della nuova chat: ricarica la
    // lista per sostituire la bozza in memoria con la sessione persistita.
    void load();
    if (selectedSessionId) void loadMessages(selectedSessionId);
    setMemoryRevision((revision) => revision + 1);
  }, [load, selectedSessionId, loadMessages]);

  const handleTruncateFromMessage = useCallback((messageId: string) => {
    setMessages(current => {
      const index = current.findIndex(message => message.id === messageId);
      return index >= 0 ? current.slice(0, index) : current;
    });
  }, []);

  return (
    <div className={`app${appearance.sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <div
        className={`sidebar-scrim${sidebarOpen ? ' is-visible' : ''}`}
        role="presentation"
        aria-hidden="true"
        onClick={() => setSidebarOpen(false)}
      />
      <Sidebar
        sessions={sessions}
        onSelect={handleSelectSession}
        onCreate={handleNewSession}
        onRename={rename}
        onArchive={archive}
        onDelete={handleDeleteSession}
        selectedSessionId={selectedSessionId}
        loading={loading}
        error={error}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        settingsActive={adminOpen}
        onOpenSettings={() => {
          setAdminOpen(true);
          setProjectOpen(false);
          setSecondBrainOpen(false);
          setSidebarOpen(false);
        }}
        onOpenSecondBrain={() => handleOpenSecondBrain()}
        secondBrainActive={secondBrainOpen}
        onLogout={() => void logout()}
        projects={projects}
        sections={sections}
        turnStatuses={turnStatuses}
        unreadSessions={unreadSessions}
        selectedProjectId={selectedProjectId}
        onSelectProject={handleSelectProject}
        onEditProject={handleEditProject}
        onDeleteProject={project => setProjectDeleteTarget(project)}
        onNewProject={handleNewProject}
        onCreateInProject={handleNewSessionInProject}
        onNewSection={openNewSection}
        onEditSection={openEditSection}
        onDeleteSection={section => { setSectionDeleteError(null); setSectionDeleteTarget(section); }}
        projectSettingsActive={projectOpen}
        collapsed={appearance.sidebarCollapsed}
      />

      <main className="main-panel">
        <header className="topbar">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={appearance.sidebarCollapsed ? 'Apri la barra chat' : 'Comprimi la barra chat'}
            aria-expanded={sidebarOpen || !appearance.sidebarCollapsed}
            title={`${appearance.sidebarCollapsed ? 'Apri' : 'Comprimi'} barra chat (Ctrl+B)`}
            onClick={handleToggleSidebar}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="topbar-heading">
            <span className="topbar-eyebrow">{adminOpen ? t('Configurazione runtime') : secondBrainOpen ? t('Memoria personale') : projectOpen ? t('Progetto') : t('Conversazione')}</span>
            <h1 title={selectedSessionTitle}>{selectedSessionTitle}</h1>
          </div>

          <div className="topbar-actions">
            {!adminOpen && !projectOpen && !secondBrainOpen && (
              <>
              <div className="chat-model-fields">
                <ModelSelector
                  sessionId={selectedSessionId}
                  currentModelId={selectedModelId}
                  provider={selectedProvider}
                  onModelChange={(modelId) => {
                    explicitModelSelection.current = true;
                    setSelectedModelId(modelId);
                    saveStoredModelSelection({ modelId, provider: selectedProvider, reasoningLevel: selectedReasoningLevel });
                  }}
                />
                <ReasoningSelector
                  value={selectedReasoningLevel}
                  onChange={(level) => {
                    setSelectedReasoningLevel(level);
                    if (selectedSessionId) void setSessionReasoningLevel(selectedSessionId, level);
                    if (selectedModelId) saveStoredModelSelection({ modelId: selectedModelId, provider: selectedProvider, reasoningLevel: level });
                  }}
                />
              </div>
              </>
            )}
          </div>
        </header>

        <div className="workspace">
          {adminOpen && <AdminSettings onClose={() => setAdminOpen(false)} />}

          {!adminOpen && secondBrainOpen && (
            <SecondBrainPage
              projects={projects}
              refreshKey={memoryRevision}
              initialScope={secondBrainScope}
              onClose={() => setSecondBrainOpen(false)}
            />
          )}

          {!adminOpen && !secondBrainOpen && projectOpen && selectedProject && (
            <ProjectSettings
              project={selectedProject}
              onClose={() => setProjectOpen(false)}
              onSaved={handleProjectSaved}
              onSourcesChanged={() => setMemoryRevision(revision => revision + 1)}
              onRequestDelete={project => setProjectDeleteTarget(project)}
              sections={sections}
            />
          )}

          {!adminOpen && !secondBrainOpen && !projectOpen && !selectedSessionId && (
            <section className="empty-state">
              <span className="empty-state-icon" aria-hidden="true">
                <img src="/brand/memora-avatar.png" alt="" />
              </span>
              <h2>
                {visibleSessions.length === 0 ? (selectedProject ? t('Nessuna chat per {name}', { name: selectedProject.name }) : t('Benvenuto in Memora')) : t('Seleziona una chat')}
              </h2>
              <p>
                {visibleSessions.length === 0
                  ? t('Crea una nuova conversazione per iniziare a usare Memora.')
                  : t('Scegli una conversazione dalla sidebar oppure iniziane una nuova.')}
              </p>
              <button type="button" className="empty-state-action" onClick={() => void handleNewSession()} disabled={loading}>
                Nuova chat
              </button>
            </section>
          )}

          {!adminOpen && !secondBrainOpen && !projectOpen && selectedSessionId && (
            <Chat
              sessionId={selectedSessionId}
              messages={messages}
              onStartTurn={handleStartTurn}
              onStreamingUpdate={handleStreamingUpdate}
              onTurnComplete={handleTurnComplete}
              onSessionTitle={() => void load()}
              onTruncateFromMessage={handleTruncateFromMessage}
              project={chatProject}
              projects={projects}
              turnStatus={selectedSessionId ? turnsBySession[selectedSessionId]?.status ?? null : null}
              queuedTurn={selectedSessionId ? turnsBySession[selectedSessionId] ?? null : null}
              onSessionUnavailable={handleRecoverSession}
              agentProfiles={agentProfiles}
              agent={selectedSession?.agent ?? null}
              onAgentChange={() => void load()}
              allowAgentPicker={Boolean(selectedSession?.draft || selectedSession?.messageCount === 0)}
            />
          )}
        </div>

        {!adminOpen && !secondBrainOpen && !projectOpen && (
          <ChatMemoryPanel
            refreshKey={memoryRevision}
            projectId={chatProject?.id ?? selectedProjectId}
            projectName={chatProject?.name}
            onOpenSecondBrain={handleOpenSecondBrain}
          />
        )}
      </main>
      {newProjectOpen && <NewProjectDialog sections={sections} initialSectionId={newProjectSectionId} onClose={() => { setNewProjectOpen(false); setNewProjectSectionId(null); }} onCreated={handleProjectCreated} />}
      {sectionDialogOpen && <SectionDialog section={sectionEditTarget} onClose={() => { setSectionDialogOpen(false); setSectionEditTarget(null); }} onSaved={handleSectionSaved} />}
      {sectionDeleteTarget && (
        <ConfirmDialog
          title={`${t('Elimina sezione')}: “${sectionDeleteTarget.name}”?`}
          confirmLabel={t('Elimina sezione')}
          busy={sectionDeleteBusy}
          error={sectionDeleteError}
          onClose={() => { if (!sectionDeleteBusy) { setSectionDeleteTarget(null); setSectionDeleteError(null); } }}
          onConfirm={() => void handleDeleteSection()}
        >
          <p>{t('La sezione può essere eliminata solo se non contiene progetti.')}</p>
        </ConfirmDialog>
      )}
      {projectDeleteTarget && (
        <ProjectDeleteDialog
          project={projectDeleteTarget}
          onClose={() => setProjectDeleteTarget(null)}
          onDeleted={handleProjectDeleted}
        />
      )}
    </div>
  );
}
