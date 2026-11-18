import type { ProjectRecord } from './projects.js';

export const APP_NAME = 'memora';

/**
 * Restituisce il solo testo destinato all'utente dai content block Pi.
 *
 * Il formato Pi può contenere thinking/reasoning, tool call e blocchi futuri:
 * questi dati restano disponibili internamente ma non diventano testo della chat.
 */
export function normalizePiContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        return (block as { text: string }).text;
      }
      return '';
    })
    .join('');
}

/** Identificatore di una sessione attiva */
export type SessionId = string;

/** Informazioni sintetiche su una sessione (per listagem) */
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
  /** Stato di archiviazione (metadata Memora, non nel contesto LLM). */
  archived?: boolean;
  /** Progetto associato alla sessione, se presente. */
  projectId?: string;
  /** Sessione creata ma non ancora persistita su JSONL (Pi crea il file al primo messaggio). */
  draft?: boolean;
}

/** Stato di un candidato memoria. */
export type MemoryCandidateStatus = 'pending' | 'approved' | 'rejected' | 'conflict';

/** Origine della proposta di memoria. */
export type MemoryCandidateOrigin = 'explicit' | 'automatic';

/** Priorità di revisione del candidato. */
export type MemoryCandidatePriority = 'high' | 'normal';

/** Riferimento a contenuto già presente nella knowledge base. */
export interface MemoryCandidateMatch {
  relativePath: string;
  heading: string | null;
  content: string;
  score: number;
}

export type MemoryType = 'profile_fact' | 'preference' | 'decision' | 'project_fact' | 'project_decision' | 'workflow' | 'goal' | 'relationship' | 'correction' | 'other';
export type MemoryAction = 'new' | 'update' | 'duplicate' | 'conflict';
export type MemoryUpdateIntent = 'augment' | 'replace' | 'remove' | 'correct';

/**
 * Proposta di memoria. Non è conoscenza autorevole finché non viene approvata.
 * Non contiene chain-of-thought: `rationale` è una motivazione sintetica e
 * deterministica prodotta dalla pipeline locale.
 */
export interface MemoryCandidate {
  id: string;
  createdAt: number;
  updatedAt: number;
  sessionId: string;
  sourceMessageId?: string;
  sourceTimestamp?: number;
  turnId?: string;
  category: string;
  project?: string;
  projectId?: string;
  heading: string;
  proposedText: string;
  rationale: string;
  status: MemoryCandidateStatus;
  targetPath: string;
  duplicateOf?: MemoryCandidateMatch;
  conflictsWith?: MemoryCandidateMatch;
  origin: MemoryCandidateOrigin;
  priority: MemoryCandidatePriority;
  sensitive?: boolean;
  rejectionReason?: string;
  writtenPath?: string;
  writtenAt?: number;
  skippedDuplicate?: boolean;
  purgedAt?: number;
  purgeReason?: string;
  importanceScore?: number;
  durabilityScore?: number;
  futureUtilityScore?: number;
  noveltyScore?: number;
  confidenceScore?: number;
  salienceScore?: number;
  memoryType?: MemoryType;
  action?: MemoryAction;
  updateIntent?: MemoryUpdateIntent;
  entityType?: string;
  entityName?: string;
  currentText?: string;
  relatedSourceIds?: string[];
  curatorProvider?: string;
  curatorModel?: string;
  /** Provenienza dell'affermazione: utente o risposta assistente promossa esplicitamente. */
  sourceKind?: 'user' | 'assistant';
  /** Domanda utente che ha originato una risposta promossa a memoria. */
  sourceQuestion?: string;
  /** Turni recenti (utente/assistente) usati come contesto per la proposta. */
  sourceContext?: string[];
}

export interface AssistantMemoryProposal {
  proposedText: string;
  category: string;
  heading: string;
  action: 'new' | 'update';
  currentText?: string;
  rationale: string;
  confidence?: number;
  project?: string;
  projectId?: string;
}

/** Input di un turno per l'estrazione dei candidati memoria. */
export interface MemoryTurnInput {
  sessionId: string;
  projectId?: string;
  userText: string;
  assistantText?: string;
  /** Breve finestra di precedenti messaggi utente, non affermazioni dell'assistente. */
  recentUserMessages?: string[];
  sourceMessageId?: string;
  sourceTimestamp?: number;
  turnId?: string;
  sourceKind?: 'user' | 'assistant';
}

/** Interfaccia minimale del Memory Writer usata da AgentService. */
export interface MemoryWriterLike {
  processTurn(input: MemoryTurnInput): Promise<{ created: MemoryCandidate[] }>;
}

/** Configurazione di AgentService, derivata da environment / configuration */
export interface AgentServiceConfig {
  /** Directory principale dei dati runtime (MEMORA_DATA_DIR) */
  dataDir: string;
  /** Working directory legacy: non è il workspace delle sessioni personal assistant. */
  cwd: string;
  /** CWD isolato delle sessioni personal assistant (default: $MEMORA_DATA_DIR/runtime/assistant). */
  assistantCwd?: string;
  /** API key OpenRouter (da OPENROUTER_API_KEY, mai hardcoded) */
  openRouterApiKey: string;
  /** Modello chat predefinito. */
  openRouterModel: string;
  /** Provider chat predefinito (default openrouter). */
  chatProvider?: import('./providers.js').ProviderId;
  chatReasoningLevel?: import('./providers.js').ReasoningLevel;
  /** API key runtime per provider; non vengono scritte su disco. */
  providerApiKeys?: Partial<Record<import('./providers.js').ProviderId, string>>;
  /** Servizio memoria opzionale per il retrieval di contesto. */
  memoryService?: MemoryServiceLike;
  /** Writer opzionale che propone candidati memoria dopo un turno. */
  memoryWriter?: MemoryWriterLike;
  /** Registry progetti per prompt e default di sessione. */
  projectStore?: ProjectStoreLike;
  /** Servizio web opzionale (ricerca e lettura pagine). */
  webService?: WebServiceLike;
}

/** Interfaccia minimale per il servizio memoria (evita dipendenze circolari). */
export interface MemoryHistoryEntry {
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

export interface WebServiceLike {
  search(query: string): Promise<import('./web.js').WebSearchResult[]>;
  fetchPage(url: string, query?: string): Promise<{ source: import('./web.js').WebSource; text: string }>;
}

export interface ProjectStoreLike {
  get(id: string): Promise<ProjectRecord | null>;
}

export interface MemoryServiceLike {
  search(query: string, options?: { topK?: number; maxChars?: number; maxTokens?: number; category?: string; project?: string; projectId?: string; globalOnly?: boolean; memoryType?: string; minConfidence?: number; diversity?: number }): Promise<Array<{
    sourceId: string;
    relativePath: string;
    category: string;
    heading: string | null;
    startLine: number;
    endLine: number;
    content: string;
    score: number;
  }>>;
  searchScoped?(query: string, options?: { topK?: number; maxChars?: number; maxTokens?: number; category?: string; projectId?: string; includeGlobal?: boolean; includeProjectMemory?: boolean; includeProjectSources?: boolean; memoryType?: string; minConfidence?: number; diversity?: number }): Promise<Array<{
    sourceId: string;
    relativePath: string;
    category: string;
    heading: string | null;
    startLine: number;
    endLine: number;
    content: string;
    score: number;
    projectId?: string;
  }>>;
  listSources(): Promise<Array<{
    id: string;
    path: string;
    relativePath: string;
    category: string;
    modifiedAt: number;
    size: number;
    contentHash: string;
    indexedAt: number;
    chunkCount: number;
    title: string | null;
  }>>;
  /** Cerca solo nelle versioni superate, per domande storiche esplicite. */
  searchHistory?(query: string, options?: { topK?: number; relativePaths?: string[]; fallbackToLatest?: boolean }): Promise<MemoryHistoryEntry[]>;
  reindex(): Promise<void>;
}

/** Informazioni su un modello disponibile tramite Pi SDK */
export interface AvailableModel {
  /** ID del modello (es. openrouter/free) */
  id: string;
  /** Nome leggibile */
  name: string;
  /** Provider (es. openrouter) */
  provider: string;
  /** API usata (es. openai-completions) */
  api: string;
  /** Finestra di contesto in token */
  contextWindow: number;
  /** Costo input per token (milione) */
  costInput: number;
  /** Costo output per token (milione) */
  costOutput: number;
  /** Il modello supporta il reasoning */
  reasoning: boolean;
  /** Il modello è gratuito (costo input e output = 0) */
  isFree: boolean;
  /** Il modello è un router (es. openrouter/free sceglie modelli fisici) */
  isRouter: boolean;
  /** Livelli di reasoning esposti dal modello. */
  reasoningLevels?: import('./providers.js').ReasoningLevel[];
}

/** Risultato di creazione sessione */
export interface CreateSessionResult {
  sessionId: string;
  sessionFile: string | undefined;
  modelId?: string;
  provider?: import('./providers.js').ProviderId;
  reasoningLevel?: import('./providers.js').ReasoningLevel;
  projectId?: string;
}

/** Payload per cambio modello di una sessione esistente */
export interface SetSessionModelResult {
  sessionId: string;
  modelId: string;
  provider?: import('./providers.js').ProviderId;
  reasoningLevel?: import('./providers.js').ReasoningLevel;
}

/** Evento di streaming inviato via SSE */
export interface StreamEvent {
  type: string;
  sessionId: string;
  timestamp: number;
  payload: unknown;
}

/** Errore di AgentService */
export class AgentServiceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AgentServiceError';
  }
}

export * from './settings.js';
export * from './web.js';
export * from './providers.js';

export type {
  ProjectConfig,
  ProjectDefaults,
  ProjectRecord,
  ProjectRetrievalConfig,
  ProjectSourcesConfig,
  ProjectStatus,
  ProjectFileKind,
  ProjectFileInfo,
  ProjectFileList,
  ProjectFilePreview,
  ChatAttachment,
  ChatAttachmentKind,
  ChatAttachmentContext,
  SessionContextSettings,
  ArtifactKind,
  ChatArtifact,
  ArtifactVersion,
  SpreadsheetCell,
  SpreadsheetSheet,
  SpreadsheetPreview,
} from './projects.js';
export { DEFAULT_SESSION_CONTEXT } from './projects.js';
export { classifyProjectFile, isOfficeArtifactKind } from './projects.js';
