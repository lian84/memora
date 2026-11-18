import {
  normalizePiContent,
  type AdminSettings,
  type AdminSettingsUpdate,
  type AdminStatus,
  type MemoryCandidate,
  type AssistantMemoryProposal,
  type ProviderCatalog,
  type ProviderConnectionResult,
  type ProviderId,
  type ProviderSecretStatus,
  type ReasoningLevel,
  type MemoryCandidateStatus,
  type ProjectRecord,
  type ProjectIcon,
  type ProjectSection,
  type RuntimeSettingsPatch,
  type ChatAttachment,
  type ProjectFileList,
  type ProjectFilePreview,
  type SessionContextSettings,
  type ChatArtifact,
  type ArtifactVersion,
  type SpreadsheetPreview,
  type WebSettingsView,
} from '@memora/shared';

const API_BASE = (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isSessionNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && (error.code === 'session_not_found' || /session not found|sessione non trovata/i.test(error.message));
}

export interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  api: string;
  contextWindow: number;
  costInput: number;
  costOutput: number;
  reasoning: boolean;
  isFree: boolean;
  isRouter: boolean;
}

export interface SessionInfo {
  sessionId: string;
  sessionFile: string | undefined;
  cwd: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
  /** Nome visualizzabile impostato dall'utente (via session_info nativa Pi). */
  name?: string;
  /** Stato di archiviazione (metadata Memora). */
  archived?: boolean;
  projectId?: string;
  /** Sessione ancora in memoria: il JSONL verrà creato al primo messaggio. */
  draft?: boolean;
}

export type ProjectPatch = Partial<Pick<ProjectRecord, 'name' | 'description' | 'prompt' | 'status' | 'defaults' | 'retrieval' | 'sources'>> & { sectionId?: string | null; icon?: ProjectIcon | null };

export interface MemorySource {
  id: string;
  path: string;
  relativePath: string;
  category: string;
  projectId?: string;
  modifiedAt: number;
  size: number;
  contentHash: string;
  indexedAt: number;
  chunkCount: number;
  title: string | null;
}

export interface MemorySourceDetail extends MemorySource {
  content: string;
}

export interface MemoryHistoryRecord {
  memoryId: string;
  versionId: string;
  version: number;
  status: 'active' | 'superseded';
  text: string;
  relativePath: string;
  line: number;
  createdAt: number;
  updatedAt: number;
  sourceSessionId?: string;
  sourceMessageId?: string;
  sourceTimestamp?: number;
  confidence?: number;
  project?: string;
  curatorProvider?: string;
  curatorModel?: string;
  supersededBy?: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  entryId?: string;
  attachments?: ChatAttachment[];
}

export type TurnStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted';

export interface TurnInfo {
  turnId: string;
  sessionId: string;
  status: TurnStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
  firstSeq: number;
  lastSeq: number;
}

export interface SSEEvent {
  type: string;
  sessionId: string;
  timestamp: number;
  payload: unknown;
}

export interface CreateSessionResult {
  sessionId: string;
  sessionFile: string | undefined;
  modelId?: string;
  provider?: ProviderId;
  reasoningLevel?: ReasoningLevel;
  projectId?: string;
}

async function request(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined && options.body !== null;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  // Fastify rifiuta con 400 un DELETE/GET che dichiara application/json ma ha
  // body vuoto (FST_ERR_CTP_EMPTY_JSON_BODY). Imposta il content-type solo
  // quando viene inviato davvero un body JSON.
  if (hasBody && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401 && !path.startsWith('/api/auth/') && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('memora-auth-expired'));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: string; message?: string };
      code = parsed.error;
      const apiDetail = parsed.message ?? parsed.error;
      if (apiDetail) detail = apiDetail.replaceAll('_', ' ');
    } catch {
      // Mantieni il testo HTTP se non è JSON.
    }
    throw new ApiError(res.status, `${res.status}: ${detail || res.statusText}`, code);
  }
  return res;
}

export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
}

export interface WebStatus {
  configured: boolean;
  enabled: boolean;
  provider: 'brave' | 'searxng';
}

export async function getWebStatus(): Promise<WebStatus> {
  const res = await request('/api/web/status');
  return res.json();
}

export async function getAdminWebSettings(): Promise<WebSettingsView> {
  const res = await request('/api/admin/web');
  const data = await res.json() as { settings: WebSettingsView };
  return data.settings;
}

export async function updateAdminWebSettings(patch: Partial<WebSettingsView> & { braveApiKey?: string }): Promise<WebSettingsView> {
  const res = await request('/api/admin/web', { method: 'PATCH', body: JSON.stringify(patch) });
  const data = await res.json() as { settings: WebSettingsView };
  return data.settings;
}

export async function testAdminWebSearch(): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const res = await request('/api/admin/web/test', { method: 'POST' });
  const data = await res.json() as { results: Array<{ title: string; url: string; snippet: string }> };
  return data.results;
}

export async function getSessionWeb(sessionId: string): Promise<{ enabled: boolean }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/web`);
  return res.json();
}

export async function setSessionWeb(sessionId: string, enabled: boolean): Promise<{ enabled: boolean }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/web`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
  return res.json();
}

export async function listWebSources(sessionId: string): Promise<import('@memora/shared').WebSource[]> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/web/sources`);
  const data = await res.json() as { sources: import('@memora/shared').WebSource[] };
  return data.sources;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await request('/api/auth/status');
  return res.json();
}

export async function setupPassword(password: string): Promise<void> {
  await request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password }) });
}

export async function login(password: string): Promise<void> {
  await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' });
}

export async function listSessions(onlyArchived = false): Promise<SessionInfo[]> {
  const path = onlyArchived ? '/api/sessions?archived=true' : '/api/sessions';
  const res = await request(path);
  const data = (await res.json()) as { sessions: SessionInfo[] };
  return data.sessions;
}

export async function renameSession(
  sessionId: string,
  name: string,
): Promise<{ sessionId: string; name: string }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<{ sessionId: string; deleted: boolean }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  const data = (await res.json()) as { sessionId?: string; deleted?: boolean };
  if (data.sessionId !== sessionId || data.deleted !== true) {
    throw new Error('Risposta non valida dalla cancellazione della sessione');
  }
  return { sessionId: data.sessionId, deleted: data.deleted };
}

export async function setSessionArchived(
  sessionId: string,
  archived: boolean,
): Promise<{ sessionId: string; archived: boolean }> {
  const res = await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/archive`,
    {
      method: 'PATCH',
      body: JSON.stringify({ archived }),
    },
  );
  return res.json();
}

export interface MemoryCandidateUpdate {
  proposedText?: string;
  targetPath?: string;
  category?: string;
  project?: string;
  heading?: string;
}

export async function extractMemoryProposals(sessionId: string, text: string, options: { question?: string; context?: string[]; projectId?: string | null } = {}): Promise<{ proposals: AssistantMemoryProposal[] | null; warning?: string }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/memory/proposals`, {
    method: 'POST',
    body: JSON.stringify({ text, ...(options.question ? { question: options.question } : {}), ...(options.context?.length ? { context: options.context } : {}), ...(options.projectId !== undefined ? { projectId: options.projectId } : {}) }),
  });
  const data = await res.json() as { proposals: AssistantMemoryProposal[] | null; warning?: string };
  return data;
}

export async function saveResponseAsMemory(sessionId: string, text: string, options: { sourceMessageId?: string; sourceTimestamp?: number; question?: string; context?: string[]; projectId?: string | null; category?: string; heading?: string; action?: 'new' | 'update'; currentText?: string } = {}): Promise<MemoryCandidate> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/memory`, {
    method: 'POST',
    body: JSON.stringify({ text, ...(options.sourceMessageId ? { sourceMessageId: options.sourceMessageId } : {}), ...(options.sourceTimestamp ? { sourceTimestamp: options.sourceTimestamp } : {}), ...(options.question ? { question: options.question } : {}), ...(options.context?.length ? { context: options.context } : {}), ...(options.projectId !== undefined ? { projectId: options.projectId } : {}), ...(options.category ? { category: options.category } : {}), ...(options.heading ? { heading: options.heading } : {}), ...(options.action === 'update' && options.currentText ? { action: 'update' as const, currentText: options.currentText } : {}) }),
  });
  const data = await res.json() as { candidate: MemoryCandidate };
  return data.candidate;
}

export async function listMemoryCandidates(status?: MemoryCandidateStatus, projectId?: string): Promise<MemoryCandidate[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (projectId) params.set('projectId', projectId);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  const res = await request(`/api/memory/candidates${query}`);
  const data = (await res.json()) as { candidates: MemoryCandidate[] };
  return data.candidates;
}

export async function updateMemoryCandidate(
  id: string,
  update: MemoryCandidateUpdate,
): Promise<MemoryCandidate> {
  const res = await request(`/api/memory/candidates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
  const data = (await res.json()) as { candidate: MemoryCandidate };
  return data.candidate;
}

export async function approveMemoryCandidate(
  id: string,
  update: MemoryCandidateUpdate = {},
): Promise<{ candidate: MemoryCandidate; reindexed: boolean; markdownChanged: boolean }> {
  const res = await request(`/api/memory/candidates/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify(update),
  });
  return res.json();
}

export async function rejectMemoryCandidate(id: string, reason?: string): Promise<MemoryCandidate> {
  const res = await request(`/api/memory/candidates/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  const data = (await res.json()) as { candidate: MemoryCandidate };
  return data.candidate;
}

export async function listTurns(): Promise<TurnInfo[]> {
  const res = await request('/api/turns');
  const data = (await res.json()) as { turns: TurnInfo[] };
  return data.turns;
}

export async function getCurrentTurn(sessionId: string): Promise<TurnInfo | null> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/turns/current`);
  const data = (await res.json()) as { turn: TurnInfo | null };
  return data.turn;
}

export async function startTurn(sessionId: string, text: string, attachmentIds: string[] = [], entryId?: string): Promise<TurnInfo> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: 'POST',
    body: JSON.stringify({ text, attachmentIds, ...(entryId ? { entryId } : {}) }),
  });
  const data = (await res.json()) as { turn: TurnInfo };
  return data.turn;
}

export async function startEditTurn(sessionId: string, entryId: string, text: string, attachmentIds: string[] = []): Promise<TurnInfo> {
  return startTurn(sessionId, text, attachmentIds, entryId);
}

export async function abortTurn(sessionId: string, turnId: string): Promise<TurnInfo> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/abort`, { method: 'POST' });
  const data = (await res.json()) as { turn: TurnInfo };
  return data.turn;
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const res = await request('/api/projects');
  const data = (await res.json()) as { projects: ProjectRecord[] };
  return data.projects;
}

export async function getProject(id: string): Promise<ProjectRecord> {
  const res = await request(`/api/projects/${encodeURIComponent(id)}`);
  const data = (await res.json()) as { project: ProjectRecord };
  return data.project;
}

export async function createProject(input: { id: string; name: string; description?: string; prompt?: string; sectionId?: string; icon?: ProjectIcon }): Promise<ProjectRecord> {
  const res = await request('/api/projects', { method: 'POST', body: JSON.stringify(input) });
  const data = (await res.json()) as { project: ProjectRecord };
  return data.project;
}

export async function listProjectSections(): Promise<ProjectSection[]> {
  const res = await request('/api/project-sections');
  const data = (await res.json()) as { sections: ProjectSection[] };
  return data.sections;
}

export async function createProjectSection(input: { name: string; icon?: ProjectIcon }): Promise<ProjectSection> {
  const res = await request('/api/project-sections', { method: 'POST', body: JSON.stringify(input) });
  const data = (await res.json()) as { section: ProjectSection };
  return data.section;
}

export async function updateProjectSection(id: string, patch: { name?: string; icon?: ProjectIcon }): Promise<ProjectSection> {
  const res = await request(`/api/project-sections/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  const data = (await res.json()) as { section: ProjectSection };
  return data.section;
}

export async function deleteProjectSection(id: string): Promise<{ id: string; deleted: boolean }> {
  const res = await request(`/api/project-sections/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.json();
}

export async function exportProject(id: string): Promise<{ schemaVersion: 1; project: ProjectRecord; sources: Array<{ relativePath: string; content: string }> }> {
  const res = await request(`/api/projects/${encodeURIComponent(id)}/export`);
  return res.json();
}

export async function updateProject(id: string, patch: ProjectPatch): Promise<ProjectRecord> {
  const res = await request(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  const data = (await res.json()) as { project: ProjectRecord };
  return data.project;
}

export async function deleteProject(id: string, confirm: string): Promise<{ id: string; deleted: boolean; sources: number }> {
  const res = await request(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirm }),
  });
  return res.json();
}

export async function importArtifactIntoProject(projectId: string, sessionId: string, artifactId: string): Promise<{ destination: 'source' | 'file'; relativePath: string; indexed: boolean }> {
  const res = await request(`/api/projects/${encodeURIComponent(projectId)}/artifacts`, {
    method: 'POST',
    body: JSON.stringify({ sessionId, artifactId }),
  });
  return res.json();
}

export async function listProjectSources(projectId: string): Promise<MemorySource[]> {
  const res = await request(`/api/projects/${encodeURIComponent(projectId)}/sources`);
  const data = (await res.json()) as { sources: MemorySource[] };
  return data.sources;
}

export async function createProjectSource(projectId: string, relativePath: string, content: string): Promise<MemorySourceDetail> {
  const res = await request(`/api/projects/${encodeURIComponent(projectId)}/sources`, {
    method: 'POST',
    body: JSON.stringify({ relativePath, content }),
  });
  const data = (await res.json()) as { source: MemorySourceDetail };
  return data.source;
}

export async function getProjectSource(projectId: string, sourceId: string): Promise<MemorySourceDetail> {
  const res = await request(`/api/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`);
  const data = (await res.json()) as { source: MemorySourceDetail };
  return data.source;
}

export async function updateProjectSource(projectId: string, sourceId: string, content: string): Promise<MemorySourceDetail> {
  const res = await request(`/api/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
  const data = (await res.json()) as { source: MemorySourceDetail };
  return data.source;
}

export async function deleteProjectSource(projectId: string, sourceId: string): Promise<{ sourceId: string; relativePath: string; deleted: boolean; purgedCandidates: number }> {
  const res = await request(`/api/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`, { method: 'DELETE' });
  return res.json();
}

export async function listSources(): Promise<MemorySource[]> {
  const res = await request('/api/memory/sources');
  const data = await res.json();
  return data.sources;
}

export async function getMemorySource(id: string): Promise<MemorySourceDetail> {
  const res = await request(`/api/memory/sources/${encodeURIComponent(id)}`);
  const data = (await res.json()) as { source: MemorySourceDetail };
  return data.source;
}

export async function getMemorySourceHistory(id: string): Promise<MemoryHistoryRecord[]> {
  const res = await request(`/api/memory/sources/${encodeURIComponent(id)}/history`);
  const data = (await res.json()) as { records: MemoryHistoryRecord[] };
  return data.records;
}

export async function searchMemoryHistory(q: string, path?: string): Promise<MemoryHistoryRecord[]> {
  const res = await request(`/api/memory/history?q=${encodeURIComponent(q)}${path ? `&path=${encodeURIComponent(path)}` : ''}`);
  const data = (await res.json()) as { records: MemoryHistoryRecord[] };
  return data.records;
}

export async function updateMemorySource(id: string, content: string): Promise<MemorySourceDetail> {
  const res = await request(`/api/memory/sources/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
  const data = (await res.json()) as { source: MemorySourceDetail };
  return data.source;
}

export async function deleteMemorySource(id: string): Promise<{ sourceId: string; relativePath: string; deleted: boolean }> {
  const res = await request(`/api/memory/sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return res.json();
}

export async function searchMemory(
  q: string,
  options?: { topK?: number; maxChars?: number; category?: string; projectId?: string },
): Promise<Array<{
  sourceId: string;
  relativePath: string;
  category: string;
  heading: string | null;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
}>> {
  const res = await request(
    `/api/memory/search?q=${encodeURIComponent(q)}` +
      (options?.topK ? `&topK=${options.topK}` : '') +
      (options?.maxChars ? `&maxChars=${options.maxChars}` : '') +
      (options?.category ? `&category=${encodeURIComponent(options.category)}` : '') +
      (options?.projectId ? `&projectId=${encodeURIComponent(options.projectId)}` : '')
  );
  const data = await res.json();
  return data.results;
}

export async function getModels(provider?: ProviderId): Promise<AvailableModel[]> {
  const res = await request(`/api/models${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`);
  const data = await res.json();
  return data.models;
}

export async function createSession(modelId?: string, provider?: ProviderId, reasoningLevel?: ReasoningLevel, projectId?: string): Promise<CreateSessionResult> {
  const res = await request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ modelId, provider, reasoningLevel, ...(projectId ? { projectId } : {}) }),
  });
  return res.json();
}

export async function setSessionModel(
  sessionId: string,
  modelId: string,
  provider?: ProviderId,
): Promise<{ sessionId: string; modelId: string; provider?: ProviderId; reasoningLevel?: ReasoningLevel }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
    method: 'PATCH',
    body: JSON.stringify({ modelId, provider }),
  });
  return res.json();
}

export async function getSessionContext(sessionId: string): Promise<SessionContextSettings> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/context`);
  const data = await res.json() as { context: SessionContextSettings };
  return data.context;
}

export async function updateSessionContext(sessionId: string, patch: Partial<SessionContextSettings>): Promise<SessionContextSettings> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/context`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  const data = await res.json() as { context: SessionContextSettings };
  return data.context;
}

export async function setSessionReasoningLevel(sessionId: string, reasoningLevel: ReasoningLevel): Promise<{ sessionId: string; reasoningLevel: ReasoningLevel }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/reasoning`, {
    method: 'PATCH',
    body: JSON.stringify({ reasoningLevel }),
  });
  return res.json();
}

export async function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
  const data = (await res.json()) as {
    messages: Array<{
      role: 'user' | 'assistant';
      content: unknown;
      timestamp: number;
    }>;
  };

  return data.messages.map((message) => ({
    ...message,
    content: normalizePiContent(message.content),
  }));
}

export async function resumeSession(sessionId: string): Promise<{ sessionId: string; modelId: string; provider?: ProviderId; reasoningLevel?: ReasoningLevel }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
  return res.json();
}

export async function abortSession(sessionId: string): Promise<{ ok: boolean }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, { method: 'POST' });
  return res.json();
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const res = await request('/api/admin/settings');
  return res.json();
}

export async function updateAdminSettings(patch: RuntimeSettingsPatch): Promise<AdminSettingsUpdate> {
  const res = await request('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) });
  return res.json();
}

export async function getAdminStatus(): Promise<AdminStatus> {
  const res = await request('/api/admin/status');
  return res.json();
}

export async function getProviderSecrets(): Promise<Record<ProviderId, ProviderSecretStatus>> {
  const res = await request('/api/admin/secrets');
  return res.json();
}

export async function saveProviderSecret(provider: ProviderId, apiKey: string): Promise<ProviderSecretStatus & { provider: ProviderId; restartRequired: string[] }> {
  const res = await request(`/api/admin/providers/${encodeURIComponent(provider)}/secret`, {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  });
  return res.json();
}

export async function getProviderCatalog(provider: ProviderId, refresh = false): Promise<ProviderCatalog> {
  const res = await request(`/api/admin/providers/${encodeURIComponent(provider)}/models${refresh ? '?refresh=true' : ''}`);
  return res.json();
}

export async function testProviderConnection(provider: ProviderId, apiKey?: string): Promise<ProviderConnectionResult> {
  const res = await request(`/api/admin/providers/${encodeURIComponent(provider)}/test`, {
    method: 'POST',
    body: JSON.stringify(apiKey ? { apiKey } : {}),
  });
  return res.json();
}

export async function reindexMemory(): Promise<{ ok: boolean }> {
  const res = await request('/api/memory/reindex', { method: 'POST' });
  return res.json();
}

/**
 * Decodifica l'envelope SSE emesso dal backend.
 * `payload` è l'AgentSessionEvent Pi reale, non l'envelope completo.
 */
export function parseSSEEventData(data: string, fallbackSessionId: string): SSEEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const event = parsed as {
    type?: unknown;
    sessionId?: unknown;
    timestamp?: unknown;
    payload?: unknown;
  };
  if (typeof event.type !== 'string') return null;

  return {
    type: event.type,
    sessionId: typeof event.sessionId === 'string' ? event.sessionId : fallbackSessionId,
    timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
    payload: event.payload,
  };
}

export function projectFileUrl(projectId: string, relativePath: string): string {
  return `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(relativePath)}`;
}

export function artifactUrl(sessionId: string, artifactId: string): string {
  return `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

export function artifactPreviewUrl(sessionId: string, artifactId: string, version?: number): string {
  const query = version ? `?version=${encodeURIComponent(String(version))}` : '';
  return `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/preview${query}`;
}

export async function deleteArtifact(sessionId: string, artifactId: string): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`, { method: 'DELETE' });
}

export async function createSessionPdf(sessionId: string, input: { title: string; markdown?: string; html?: string; format?: 'markdown' | 'html'; filename?: string }): Promise<ChatArtifact> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts/pdf`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const data = await res.json() as { artifact: ChatArtifact };
  return data.artifact;
}

export async function createArtifactPdf(sessionId: string, artifactId: string): Promise<ChatArtifact> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/pdf`, { method: 'POST' });
  const data = await res.json() as { artifact: ChatArtifact };
  return data.artifact;
}

export function artifactVersionUrl(sessionId: string, artifactId: string, version: number): string {
  return `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/versions/${version}`;
}

export async function getArtifactSpreadsheetPreview(sessionId: string, artifactId: string, version?: number): Promise<SpreadsheetPreview> {
  const res = await request(artifactPreviewUrl(sessionId, artifactId, version));
  return res.json() as Promise<SpreadsheetPreview>;
}

export async function listArtifactVersions(sessionId: string, artifactId: string): Promise<ArtifactVersion[]> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/versions`);
  const data = await res.json() as { versions: ArtifactVersion[] };
  return data.versions;
}

export async function listSessionArtifacts(sessionId: string): Promise<ChatArtifact[]> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`);
  const data = await res.json() as { artifacts: ChatArtifact[] };
  return data.artifacts;
}

export function chatAttachmentUrl(sessionId: string, attachmentId: string): string {
  return `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export async function listProjectFiles(projectId: string): Promise<ProjectFileList> {
  const res = await request(`/api/projects/${encodeURIComponent(projectId)}/files`);
  return res.json();
}

export async function getProjectFileText(projectId: string, relativePath: string): Promise<string> {
  const res = await fetch(projectFileUrl(projectId, relativePath));
  if (!res.ok) throw new Error(`Impossibile leggere il file (${res.status})`);
  return res.text();
}

export async function getProjectFilePreview(projectId: string, relativePath: string): Promise<ProjectFilePreview> {
  const res = await request(`/api/projects/${encodeURIComponent(projectId)}/files/preview?path=${encodeURIComponent(relativePath)}`);
  return res.json();
}

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  });
}

export async function uploadChatAttachment(sessionId: string, file: File): Promise<ChatAttachment> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/attachments`, {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, data: await fileToBase64(file) }),
  });
  const data = await res.json() as { attachment: ChatAttachment };
  return data.attachment;
}

export async function deleteChatAttachment(sessionId: string, attachmentId: string): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' });
}

export async function attachArtifactToSession(sessionId: string, artifactId: string): Promise<ChatAttachment> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/attachments/from-artifact`, {
    method: 'POST',
    body: JSON.stringify({ artifactId }),
  });
  const data = await res.json() as { attachment: ChatAttachment };
  return data.attachment;
}

export async function attachProjectFileToSession(sessionId: string, projectId: string, relativePath: string): Promise<ChatAttachment> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/attachments/from-project`, {
    method: 'POST',
    body: JSON.stringify({ projectId, path: relativePath }),
  });
  const data = await res.json() as { attachment: ChatAttachment };
  return data.attachment;
}

async function consumeSSE(
  res: Response,
  sessionId: string,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  if (!res.body) throw new Error('Nessun corpo della risposta SSE');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const event = parseSSEEventData(trimmed.slice(6), sessionId);
        if (event) onEvent(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Invia un messaggio tramite SSE e chiama onEvent per ogni evento ricevuto. */
export async function sendMessage(
  sessionId: string,
  text: string,
  onEvent: (event: SSEEvent) => void,
  attachmentIds: string[] = [],
): Promise<void> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text, ...(attachmentIds.length > 0 ? { attachmentIds } : {}) }),
  });
  await consumeSSE(res, sessionId, onEvent);
}

/** Modifica una domanda della sessione e rigenera la risposta tramite SSE. */
export async function editMessage(
  sessionId: string,
  entryId: string,
  text: string,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(entryId)}/edit`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  await consumeSSE(res, sessionId, onEvent);
}
