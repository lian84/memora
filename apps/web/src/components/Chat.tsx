import { useCallback, useEffect, useRef, useState } from 'react';
import { Message } from './Message';
import { Composer } from './Composer';
import { ChatSidePanel, type ChatSidePanelTab } from './ChatSidePanel';
import { ProjectFilesView } from './ProjectFilesView';
import { SessionContextPanel } from './SessionContextPanel';
import { ArtifactsPanel } from './ArtifactsPanel';
import { WebSourcesPanel } from './WebSourcesPanel';
import { SaveMemoryDialog } from './SaveMemoryDialog';
import { useSessionTurn } from '../hooks/useSessionTurn';
import { canAutoOpenSidePanel, mergeArtifacts, mergeWebSources, readPanelToolUpdate } from '../lib/chat-panel-events';
import { useI18n } from '../i18n';
import { DEFAULT_SESSION_CONTEXT, type ChatArtifact, type ChatAttachment, type ProjectFileInfo, type ProjectRecord, type SessionContextSettings, type WebSource } from '@memora/shared';
import type { ChatMessage, SSEEvent, TurnInfo, TurnStatus, WebStatus } from '../lib/api';
import { abortSession, attachArtifactToSession, attachProjectFileToSession, createSessionPdf, deleteChatAttachment, getSessionContext, getSessionWeb, getWebStatus, importArtifactIntoProject, isSessionNotFoundError, listSessionArtifacts, listWebSources, setSessionWeb, startTurn, updateSessionContext, uploadChatAttachment } from '../lib/api';

interface MemorySource { relativePath: string; category: string; heading: string | null; startLine: number; endLine: number; }
export type DisplayChatMessage = ChatMessage & { id: string; streaming?: boolean };

export function appendOptimisticTurn(messages: DisplayChatMessage[], text: string, assistantId: string, timestamp: number, attachments: ChatAttachment[] = []): DisplayChatMessage[] {
  return [...messages, { id: `user-${assistantId}`, role: 'user', content: text, timestamp, ...(attachments.length > 0 ? { attachments } : {}) }, { id: assistantId, role: 'assistant', content: '', timestamp, streaming: true }];
}

export function updateStreamingPlaceholder(messages: DisplayChatMessage[], assistantId: string, content: string, streaming: boolean): DisplayChatMessage[] {
  return messages.map((message) => message.id === assistantId ? { ...message, content, streaming } : message);
}
interface ChatProps {
  sessionId: string | null;
  messages: DisplayChatMessage[];
  onStartTurn: (text: string, assistantId: string, timestamp: number, attachments?: ChatAttachment[]) => void;
  onStreamingUpdate: (assistantId: string, content: string, streaming: boolean) => void;
  /** Notifica la fine del turno per riallineare la lista sessioni persistite. */
  onTurnComplete?: () => void;
  /** Il server ha aggiornato il titolo automatico della sessione. */
  onSessionTitle?: () => void;
  turnStatus?: TurnStatus | null;
  /** Ultimo turno della sessione: se è in coda, mostra subito la richiesta. */
  queuedTurn?: TurnInfo | null;
  onTruncateFromMessage?: (messageId: string) => void;
  project?: ProjectRecord | null;
  projects?: ProjectRecord[];
  /** La sessione non esiste più (es. bozza persa al riavvio): ne crea una nuova. */
  onSessionUnavailable?: () => Promise<string>;
}

function getMemorySources(payload: unknown): MemorySource[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter((source): source is MemorySource => {
    if (!source || typeof source !== 'object') return false;
    const value = source as Partial<MemorySource>;
    return typeof value.relativePath === 'string' && typeof value.category === 'string' && (typeof value.heading === 'string' || value.heading === null) && typeof value.startLine === 'number' && typeof value.endLine === 'number';
  });
}
export function Chat({ sessionId, messages, onStartTurn, onStreamingUpdate, onTurnComplete, onSessionTitle, turnStatus = null, queuedTurn = null, onTruncateFromMessage, project = null, projects = [], onSessionUnavailable }: ChatProps) {
  const { t } = useI18n();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const completedTurnRef = useRef<string | null>(null);
  const streamEventHandlerRef = useRef<(event: SSEEvent) => void>(() => undefined);
  const [memorySources, setMemorySources] = useState<MemorySource[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [queuedPrompts, setQueuedPrompts] = useState<Array<{ text: string; timestamp: number }>>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<ChatSidePanelTab>(() => project ? 'files' : 'context');
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [focusArtifactId, setFocusArtifactId] = useState<string | null>(null);
  const [projectFilesRevision, setProjectFilesRevision] = useState(0);
  const [context, setContext] = useState<SessionContextSettings | null>(null);
  const [contextSaving, setContextSaving] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<ChatArtifact[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [pdfExportingId, setPdfExportingId] = useState<string | null>(null);
  const [pdfNotice, setPdfNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [memoryNotice, setMemoryNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [memoryDialogMessage, setMemoryDialogMessage] = useState<DisplayChatMessage | null>(null);
  const [composerFocus, setComposerFocus] = useState(0);
  const [webStatus, setWebStatus] = useState<WebStatus | null>(null);
  const [webEnabled, setWebEnabled] = useState(false);
  const [webSources, setWebSources] = useState<WebSource[]>([]);
  const [webSourcesLoading, setWebSourcesLoading] = useState(false);
  const [webSourcesError, setWebSourcesError] = useState<string | null>(null);
  const webSourcesRef = useRef<WebSource[]>([]);
  const artifactsRef = useRef<ChatArtifact[]>([]);
  const autoOpenedArtifactsRef = useRef<Set<string>>(new Set());
  const turnStartedAtRef = useRef(0);
  const turnStream = useSessionTurn(sessionId, { onEvent: event => streamEventHandlerRef.current(event) });
  const isStreaming = turnStream.isActive || turnStatus === 'running' || turnStatus === 'queued';
  const effectiveTurnStatus = turnStatus === 'running' || turnStatus === 'queued' || turnStatus === 'failed' || turnStatus === 'interrupted'
    ? turnStatus
    : turnStream.turn?.status ?? turnStatus;

  const openPanelTab = useCallback((tab: ChatSidePanelTab, artifactId: string | null = null) => {
    setPanelTab(tab);
    setPanelOpen(true);
    if (artifactId) setFocusArtifactId(artifactId);
  }, []);
  const clearFocusArtifact = useCallback(() => setFocusArtifactId(null), []);

  const refreshArtifacts = useCallback(async (options: { autoOpen?: boolean } = {}): Promise<ChatArtifact[]> => {
    if (!sessionId) return [];
    setArtifactsLoading(true);
    setArtifactsError(null);
    try {
      const next = await listSessionArtifacts(sessionId);
      artifactsRef.current = next;
      setArtifacts(next);
      if (options.autoOpen) {
        const candidate = next.find(artifact => artifact.updatedAt >= turnStartedAtRef.current && !autoOpenedArtifactsRef.current.has(artifact.id));
        if (candidate) {
          autoOpenedArtifactsRef.current.add(candidate.id);
          if (canAutoOpenSidePanel()) openPanelTab('artifacts', candidate.id);
        }
      }
      return next;
    } catch (err) {
      setArtifactsError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setArtifactsLoading(false);
    }
  }, [openPanelTab, sessionId]);

  useEffect(() => { void refreshArtifacts(); }, [refreshArtifacts]);

  const ingestWebSources = useCallback((incoming: WebSource[]) => {
    const current = webSourcesRef.current;
    const merged = mergeWebSources(current, incoming);
    if (merged === current) return;
    webSourcesRef.current = merged;
    setWebSources(merged);
    if (canAutoOpenSidePanel()) openPanelTab('web');
  }, [openPanelTab]);

  const ingestArtifacts = useCallback((incoming: ChatArtifact[]) => {
    const current = artifactsRef.current;
    const known = new Set(current.map(artifact => artifact.id));
    const first = incoming.find(artifact => !known.has(artifact.id));
    const merged = mergeArtifacts(current, incoming);
    if (!first || merged === current) return;
    artifactsRef.current = merged;
    setArtifacts(merged);
    autoOpenedArtifactsRef.current.add(first.id);
    if (canAutoOpenSidePanel()) openPanelTab('artifacts', first.id);
  }, [openPanelTab]);

  const handleToolExecutionEnd = useCallback((payload: unknown) => {
    const update = readPanelToolUpdate(payload);
    if (update.artifacts.length > 0) ingestArtifacts(update.artifacts);
    if (update.webSources.length > 0) ingestWebSources(update.webSources);
  }, [ingestArtifacts, ingestWebSources]);

  const handleStreamEvent = useCallback((event: SSEEvent) => {
    if (event.type === 'memory_sources') setMemorySources(getMemorySources(event.payload));
    if (event.type === 'session_title') onSessionTitle?.();
    if (event.type === 'tool_execution_end') handleToolExecutionEnd(event.payload);
    if (event.type === 'error') setAttachmentError(typeof event.payload === 'string' ? event.payload : 'Errore durante il turno.');
  }, [handleToolExecutionEnd, onSessionTitle]);
  streamEventHandlerRef.current = handleStreamEvent;

  const refreshWeb = useCallback(async (options: { autoOpen?: boolean } = {}): Promise<WebSource[]> => {
    if (!sessionId) return [];
    setWebSourcesLoading(true);
    setWebSourcesError(null);
    try {
      const [status, sessionWeb, sources] = await Promise.all([getWebStatus(), getSessionWeb(sessionId), listWebSources(sessionId)]);
      const known = new Set(webSourcesRef.current.map(source => source.id));
      const added = sources.filter(source => !known.has(source.id));
      setWebStatus(status);
      setWebEnabled(sessionWeb.enabled);
      webSourcesRef.current = sources;
      setWebSources(sources);
      if (options.autoOpen && added.length > 0 && canAutoOpenSidePanel()) openPanelTab('web');
      return sources;
    } catch (err) {
      setWebSourcesError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setWebSourcesLoading(false);
    }
  }, [openPanelTab, sessionId]);

  useEffect(() => { void refreshWeb(); }, [refreshWeb]);

  useEffect(() => {
    if (!project && panelTab === 'files') setPanelTab('context');
  }, [panelTab, project]);

  useEffect(() => {
    const turn = turnStream.turn;
    if (!turn) return;
    const assistantId = activeAssistantIdRef.current;
    if (assistantId && (turn.status === 'running' || turn.status === 'queued')) {
      onStreamingUpdate(assistantId, turnStream.content, true);
    }
    if (turn.status === 'running' || turn.status === 'queued') {
      activeTurnIdRef.current = turn.turnId;
    }
    if (turn.status === 'completed' || turn.status === 'failed' || turn.status === 'aborted') {
      if (assistantId) {
        onStreamingUpdate(assistantId, turnStream.content, false);
        activeAssistantIdRef.current = null;
      }
      if (activeTurnIdRef.current === turn.turnId && completedTurnRef.current !== turn.turnId) {
        completedTurnRef.current = turn.turnId;
        activeTurnIdRef.current = null;
        onTurnComplete?.();
        setComposerFocus(value => value + 1);
        void refreshArtifacts({ autoOpen: true });
        void refreshWeb({ autoOpen: true });
      }
    }
  }, [onStreamingUpdate, onTurnComplete, refreshArtifacts, refreshWeb, turnStream.content, turnStream.turn]);

  useEffect(() => {
    if ((turnStatus === 'running' || turnStatus === 'queued') && !turnStream.isActive) {
      void turnStream.sync();
    }
  }, [turnStatus, turnStream.isActive, turnStream.sync]);

  useEffect(() => {
    const active = turnStream.turn;
    if (!active?.text) return;
    setQueuedPrompts(current => current.some(item => item.text === active.text) ? current.filter(item => item.text !== active.text) : current);
  }, [turnStream.turn?.text, turnStream.turn?.turnId]);

  const toggleWeb = useCallback(async () => {
    if (!sessionId) return;
    setAttachmentError(null);
    try {
      const next = await setSessionWeb(sessionId, !webEnabled);
      setWebEnabled(next.enabled);
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId, webEnabled]);

  useEffect(() => {
    setAttachments([]);
    setAttachmentError(null);
    setQueuedPrompts([]);
    setPanelOpen(false);
    setPanelTab(project ? 'files' : 'context');
    setPanelExpanded(false);
    setFocusArtifactId(null);
    setContext(null);
    setContextError(null);
    setArtifacts([]);
    artifactsRef.current = [];
    setArtifactsError(null);
    setWebEnabled(false);
    setWebSources([]);
    webSourcesRef.current = [];
    setWebSourcesError(null);
    activeAssistantIdRef.current = null;
    activeTurnIdRef.current = null;
    completedTurnRef.current = null;
    autoOpenedArtifactsRef.current = new Set();
    turnStartedAtRef.current = 0;
    if (!sessionId) return;
    let cancelled = false;
    void getSessionContext(sessionId)
      .then(next => { if (!cancelled) setContext(next); })
      .catch(err => { if (!cancelled) { setContextError(err instanceof Error ? err.message : String(err)); setContext(current => current ?? { ...DEFAULT_SESSION_CONTEXT }); } });
    return () => { cancelled = true; };
  }, [sessionId, project?.id]);

  const scrollToBottom = useCallback(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, []);
  useEffect(() => { scrollToBottom(); }, [messages, isStreaming, scrollToBottom]);

  const addUploadedAttachment = useCallback((attachment: ChatAttachment) => {
    setAttachments(current => current.some(item => item.id === attachment.id) ? current : [...current, attachment].slice(0, 8));
    if (attachment.projectPath) setProjectFilesRevision(revision => revision + 1);
  }, []);

  const handleFilesSelected = useCallback(async (files: FileList) => {
    if (!sessionId) return;
    const selected = Array.from(files);
    if (selected.length === 0) return;
    if (attachments.length + selected.length > 8) {
      setAttachmentError('Massimo 8 allegati per messaggio.');
      return;
    }
    setAttachmentError(null);
    setAttachmentBusy(true);
    const uploadTo = async (targetSessionId: string) => {
      for (const file of selected) {
        const attachment = await uploadChatAttachment(targetSessionId, file);
        addUploadedAttachment(attachment);
      }
    };
    try {
      await uploadTo(sessionId);
    } catch (err) {
      if (isSessionNotFoundError(err) && onSessionUnavailable) {
        try {
          const newSessionId = await onSessionUnavailable();
          await uploadTo(newSessionId);
          setAttachmentError('La chat precedente non era più disponibile: ho aperto una nuova chat e ricaricato gli allegati.');
        } catch (recoveryError) {
          setAttachmentError(recoveryError instanceof Error ? recoveryError.message : String(recoveryError));
        }
      } else {
        setAttachmentError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setAttachmentBusy(false);
    }
  }, [sessionId, attachments.length, addUploadedAttachment, onSessionUnavailable]);

  const handleAttachProjectFile = useCallback(async (file: ProjectFileInfo) => {
    if (!sessionId || !project) return;
    if (attachments.length >= 8) throw new Error('Massimo 8 allegati per messaggio.');
    setAttachmentBusy(true);
    setAttachmentError(null);
    try {
      const attachment = await attachProjectFileToSession(sessionId, project.id, file.path);
      addUploadedAttachment(attachment);
    } catch (err) {
      if (isSessionNotFoundError(err) && onSessionUnavailable) {
        const newSessionId = await onSessionUnavailable();
        const attachment = await attachProjectFileToSession(newSessionId, project.id, file.path);
        addUploadedAttachment(attachment);
        setAttachmentError('La chat precedente non era più disponibile: ho aperto una nuova chat e ricaricato l’allegato.');
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setAttachmentError(message);
        throw err;
      }
    } finally {
      setAttachmentBusy(false);
    }
  }, [sessionId, project, attachments.length, addUploadedAttachment, onSessionUnavailable]);

  const handleAttachArtifact = useCallback(async (artifact: ChatArtifact) => {
    if (!sessionId) throw new Error('Nessuna chat attiva.');
    if (attachments.length >= 8) throw new Error('Massimo 8 allegati per messaggio.');
    setAttachmentBusy(true);
    setAttachmentError(null);
    const attachTo = async (targetSessionId: string) => {
      const attachment = await attachArtifactToSession(targetSessionId, artifact.id);
      addUploadedAttachment(attachment);
    };
    try {
      await attachTo(sessionId);
      setComposerFocus(value => value + 1);
    } catch (err) {
      if (isSessionNotFoundError(err) && onSessionUnavailable) {
        const newSessionId = await onSessionUnavailable();
        await attachTo(newSessionId);
        setAttachmentError('La chat precedente non era più disponibile: ho aperto una nuova chat e ricaricato l’allegato.');
        setComposerFocus(value => value + 1);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setAttachmentError(message);
        throw err;
      }
    } finally {
      setAttachmentBusy(false);
    }
  }, [sessionId, attachments.length, addUploadedAttachment, onSessionUnavailable]);

  const handleAddArtifactToProject = useCallback(async (artifact: ChatArtifact) => {
    if (!project || !sessionId) throw new Error('Nessun progetto attivo per questa chat.');
    const result = await importArtifactIntoProject(project.id, sessionId, artifact.id);
    setProjectFilesRevision(revision => revision + 1);
    return result;
  }, [project, sessionId]);

function extractHtmlFromMessage(content: string): string | null {
  const fenced = content.match(/```(?:html|htm)?\s*\n([\s\S]*?)\n?```/i);
  const candidate = fenced?.[1]?.trim() ?? content.trim();
  return /<\s*(?:!doctype|html|body|style|div|h[1-6]|table|section)\b/i.test(candidate) ? candidate : null;
}

function messageTitle(content: string, html: string | null): string {
  if (html) {
    const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();
    if (heading) return heading.slice(0, 120);
    return 'Documento PDF';
  }
  const firstLine = content.split('\n').map(line => line.replace(/^#+\s*/, '').trim()).find(Boolean) ?? 'Risposta Memo';
  return firstLine.slice(0, 120);
}

  const handleExportPdf = useCallback(async (message: DisplayChatMessage) => {
    if (!sessionId || message.role !== 'assistant' || !message.content.trim()) return;
    const html = extractHtmlFromMessage(message.content);
    const title = messageTitle(message.content, html);
    setPdfExportingId(message.id);
    setPdfNotice(null);
    try {
      const artifact = await createSessionPdf(sessionId, html
        ? { title, format: 'html', html, filename: 'risposta-pi.pdf' }
        : { title, format: 'markdown', markdown: message.content, filename: 'risposta-pi.pdf' });
      setPdfNotice({ text: `PDF creato: ${artifact.name}`, error: false });
      await refreshArtifacts();
    } catch (err) {
      setPdfNotice({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setPdfExportingId(null);
    }
  }, [sessionId, refreshArtifacts]);

  const handleSaveMemory = useCallback((message: DisplayChatMessage) => {
    if (!sessionId || message.role !== 'assistant' || !message.content.trim()) return;
    setMemoryDialogMessage(message);
    setMemoryNotice(null);
  }, [sessionId]);

  const handleContextChange = useCallback(async (patch: Partial<SessionContextSettings>) => {
    if (!sessionId) return;
    setContextSaving(true);
    setContextError(null);
    try {
      setContext(await updateSessionContext(sessionId, patch));
    } catch (err) {
      setContextError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextSaving(false);
    }
  }, [sessionId]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(current => current.filter(attachment => attachment.id !== id));
    if (sessionId) void deleteChatAttachment(sessionId, id).catch(() => undefined);
  }, [sessionId]);

  const handleQueue = useCallback(async (text: string) => {
    if (!sessionId) return;
    const timestamp = Date.now();
    const pendingAttachments = attachments;
    setAttachments([]);
    setAttachmentError(null);
    setQueuedPrompts(current => [...current, { text, timestamp }]);
    try {
      await startTurn(sessionId, text, pendingAttachments.map(attachment => attachment.id));
    } catch (err) {
      setQueuedPrompts(current => current.filter(item => item.timestamp !== timestamp));
      setAttachments(pendingAttachments);
      setAttachmentError(err instanceof Error ? err.message : String(err));
    }
  }, [attachments, sessionId]);

  const handleSend = useCallback(async (text: string) => {
    if (!sessionId) return;
    const timestamp = Date.now();
    const assistantId = `stream-${timestamp}-${Math.random().toString(36).slice(2)}`;
    activeAssistantIdRef.current = assistantId;
    activeTurnIdRef.current = null;
    completedTurnRef.current = null;
    turnStartedAtRef.current = timestamp;
    autoOpenedArtifactsRef.current = new Set();
    setMemorySources([]);
    const pendingAttachments = attachments;
    setAttachments([]);
    setAttachmentError(null);
    onStartTurn(text, assistantId, timestamp, pendingAttachments);
    try {
      await turnStream.start(text, pendingAttachments.map(attachment => attachment.id));
    } catch (err) {
      activeAssistantIdRef.current = null;
      setAttachments(pendingAttachments);
      setAttachmentError(err instanceof Error ? err.message : String(err));
    }
  }, [attachments, onStartTurn, sessionId, turnStream.start]);

  const handleEditMessage = useCallback(async (message: DisplayChatMessage, text: string) => {
    if (!sessionId || !message.entryId || !text.trim()) return;
    const timestamp = Date.now();
    const assistantId = `stream-${timestamp}-${Math.random().toString(36).slice(2)}`;
    activeAssistantIdRef.current = assistantId;
    activeTurnIdRef.current = null;
    completedTurnRef.current = null;
    turnStartedAtRef.current = timestamp;
    autoOpenedArtifactsRef.current = new Set();
    setMemorySources([]);
    setAttachmentError(null);
    onTruncateFromMessage?.(message.id);
    onStartTurn(text.trim(), assistantId, timestamp);
    try {
      await turnStream.startEdit(message.entryId, text.trim());
    } catch (err) {
      activeAssistantIdRef.current = null;
      setAttachmentError(err instanceof Error ? err.message : String(err));
    }
  }, [onStartTurn, onTruncateFromMessage, sessionId, turnStream.startEdit]);

  const handleRegenerate = useCallback((message: DisplayChatMessage) => {
    if (!sessionId || !message.content.trim()) return;
    void handleSend('Riformula la risposta precedente in modo più chiaro, completo e ben organizzato, mantenendo lo stesso contenuto e gli stessi fatti.');
  }, [sessionId, handleSend]);

  const handleAbort = useCallback(() => {
    if (turnStream.isActive) void turnStream.abort();
    else if (sessionId && (turnStatus === 'running' || turnStatus === 'queued')) void abortSession(sessionId);
    setComposerFocus(value => value + 1);
  }, [sessionId, turnStatus, turnStream]);

  return (
    <div className={`chat-layout${panelOpen ? ' has-side-panel' : ''}`}>
      <div className="chat-area">
      {!panelOpen && (
        <button type="button" className="project-files-reopen" onClick={() => setPanelOpen(true)} title={t('Apri pannello')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
          <span>{t('Pannello')}</span>
        </button>
      )}
      <div className="messages-container">
        {messages.length === 0 && (
          <div className="chat-empty">
            <span className="chat-empty-icon" aria-hidden="true">
              <img src="/brand/memora-avatar.png" alt="" />
            </span>
            <h2>{t('Inizia la conversazione')}</h2>
            <p>{t('Scrivi un messaggio qui sotto. Memo userà il contesto del Second Brain quando utile.')}</p>
          </div>
        )}

        {messages.map((message) => (
          <div className="message-row" key={message.id}>
            <Message role={message.role} content={message.content} timestamp={message.timestamp} streaming={message.streaming} attachments={message.attachments} sessionId={sessionId} onExportPdf={message.role === 'assistant' && !isStreaming ? () => void handleExportPdf(message) : undefined} onSaveMemory={message.role === 'assistant' && !isStreaming ? () => void handleSaveMemory(message) : undefined} onRegenerate={message.role === 'assistant' && !isStreaming ? () => handleRegenerate(message) : undefined} onEditText={message.role === 'user' && message.entryId && !isStreaming ? (text: string) => handleEditMessage(message, text) : undefined} exportingPdf={pdfExportingId === message.id} hideHtmlCode={message.role === 'assistant' && artifacts.some(artifact => artifact.kind === 'pdf' || artifact.kind === 'html' || artifact.kind === 'pptx')} webSources={webSources} />
          </div>
        ))}

        {(() => {
          const isInHistory = (text: string, timestamp: number) => messages.some(message =>
            message.role === 'user' && message.content === text && Math.abs(message.timestamp - timestamp) < 10 * 60_000,
          );
          const activePrompt = turnStream.turn?.text && (turnStream.turn.status === 'queued' || turnStream.turn.status === 'running') && !isInHistory(turnStream.turn.text, turnStream.turn.createdAt)
            ? [{ text: turnStream.turn.text, timestamp: turnStream.turn.createdAt }]
            : [];
          const queued = queuedTurn?.status === 'queued' && queuedTurn.text && !isInHistory(queuedTurn.text, queuedTurn.createdAt)
            ? [{ text: queuedTurn.text, timestamp: queuedTurn.createdAt }]
            : [];
          const pending = [...queuedPrompts, ...queued, ...activePrompt].filter((item, index, all) => !isInHistory(item.text, item.timestamp) && all.findIndex(other => other.text === item.text) === index);
          return pending.map(item => (
            <div className="message-row message-row-pending" key={`queued-${item.timestamp}-${item.text.slice(0, 12)}`}>
              <Message role="user" content={item.text} timestamp={item.timestamp} />
            </div>
          ));
        })()}
        {memorySources.length > 0 && (
          <aside className="memory-used">
            <div className="memory-used-header">{t('Memoria utilizzata ({count})', { count: memorySources.length })}</div>
            <div className="memory-used-list">
              {memorySources.map((source, index) => (
                <div className="memory-source" key={`${source.relativePath}-${index}`}>
                  <span className="memory-source-path">{source.relativePath}</span>
                  <span className="memory-source-meta">{source.category}</span>
                  {source.heading && <span className="memory-source-meta">· {source.heading}</span>}
                  <span className="memory-source-meta">L{source.startLine}-L{source.endLine}</span>
                </div>
              ))}
            </div>
          </aside>
        )}
        {turnStream.isActive && !activeAssistantIdRef.current && (
          <div className="message-row">
            <Message
              role="assistant"
              content={turnStream.content || t(effectiveTurnStatus === 'queued' ? 'In coda…' : 'Memo sta rispondendo…')}
              timestamp={Date.now()}
              streaming
            />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {(effectiveTurnStatus === 'running' || effectiveTurnStatus === 'queued') && !turnStream.isActive && (
        <div className="chat-notice is-remote-turn" role="status">
          {t(effectiveTurnStatus === 'queued' ? 'Risposta in coda per questa chat…' : 'Risposta in corso in un’altra scheda…')}
        </div>
      )}
      {(() => {
        const status = effectiveTurnStatus;
        if (status !== 'failed' && status !== 'interrupted') return null;
        const message = status === 'interrupted'
          ? t('Risposta interrotta: Memora è stato riavviato durante la generazione.')
          : turnStream.turn?.error
            ? t('La generazione è fallita: {error}', { error: turnStream.turn.error })
            : t('La generazione della risposta è fallita.');
        return <div className="chat-notice is-error" role="alert">{message}</div>;
      })()}
      {pdfNotice && <div className={`chat-notice${pdfNotice.error ? ' is-error' : ''}`} role="status">{pdfNotice.text}</div>}
      {memoryNotice && <div className={`chat-notice${memoryNotice.error ? ' is-error' : ''}`} role="status">{memoryNotice.text}</div>}
      <Composer
        onSend={handleSend}
        onQueue={isStreaming ? handleQueue : undefined}
        onAbort={handleAbort}
        disabled={!sessionId}
        isStreaming={isStreaming}
        focusKey={`${sessionId}:${composerFocus}`}
        attachments={attachments}
        onFilesSelected={handleFilesSelected}
        onRemoveAttachment={handleRemoveAttachment}
        attachmentBusy={attachmentBusy}
        attachmentError={attachmentError}
        webEnabled={webEnabled}
        webAvailable={Boolean(webStatus?.configured)}
        onToggleWeb={() => void toggleWeb()}
      />
      </div>
      {memoryDialogMessage && sessionId && (() => {
        const index = messages.findIndex(item => item.id === memoryDialogMessage.id);
        const question = index > 0 ? [...messages.slice(0, index)].reverse().find(item => item.role === 'user')?.content : undefined;
        const context = messages.slice(Math.max(0, index - 5), index).map(item => `${item.role === 'user' ? t('Utente') : 'Memo'}: ${item.content.slice(0, 700)}`);
        return (
        <SaveMemoryDialog
          sessionId={sessionId}
          content={memoryDialogMessage.content}
          question={question}
          context={context}
          sourceMessageId={memoryDialogMessage.entryId}
          sourceTimestamp={memoryDialogMessage.timestamp}
          projects={projects}
          defaultProjectId={project?.id ?? null}
          onClose={() => setMemoryDialogMessage(null)}
          onSaved={(candidates) => {
            setMemoryDialogMessage(null);
            const first = candidates[0]?.proposedText ?? '';
            setMemoryNotice({ text: `${candidates.length} candidat${candidates.length === 1 ? 'o' : 'i'} creat${candidates.length === 1 ? 'o' : 'i'}${first ? `: ${first.slice(0, 90)}${first.length > 90 ? '…' : ''}` : ''}`, error: false });
          }}
        />
        );
      })()}
      {panelOpen && (
        <ChatSidePanel
          title={project ? project.name : t('Chat')}
          eyebrow={project ? t('Progetto') : t('Chat')}
          ariaLabel={t('Pannello della chat')}
          hasFiles={Boolean(project)}
          activeTab={panelTab}
          onTabChange={setPanelTab}
          artifactsCount={artifacts.length}
          webSourcesCount={webSources.length}
          expanded={panelExpanded}
          onToggleExpanded={() => setPanelExpanded(value => !value)}
          onClose={() => setPanelOpen(false)}
        >
          {panelTab === 'files' && project ? (
            <ProjectFilesView
              project={project}
              onAttach={handleAttachProjectFile}
              refreshKey={projectFilesRevision}
            />
          ) : panelTab === 'context' || (panelTab === 'files' && !project) ? (
            <SessionContextPanel
              context={context}
              saving={contextSaving}
              error={contextError}
              hasProject={Boolean(project)}
              onChange={handleContextChange}
            />
          ) : panelTab === 'artifacts' ? (
            <ArtifactsPanel
              sessionId={sessionId}
              artifacts={artifacts}
              loading={artifactsLoading}
              error={artifactsError}
              onRefresh={() => void refreshArtifacts()}
              onAttachArtifact={handleAttachArtifact}
              onAddArtifactToProject={project ? handleAddArtifactToProject : undefined}
              focusArtifactId={focusArtifactId}
              onFocusHandled={clearFocusArtifact}
            />
          ) : (
            <WebSourcesPanel sources={webSources} loading={webSourcesLoading} error={webSourcesError} onRefresh={() => void refreshWeb()} />
          )}
        </ChatSidePanel>
      )}
    </div>
  );
}
