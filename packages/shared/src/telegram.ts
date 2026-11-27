/**
 * Tipi del canale Telegram in ingresso.
 *
 * Il bridge usa gli stessi tipi di account già presenti in `automations.ts`
 * (bot + token + chat di notifica predefinita). Questi tipi descrivono lo stato
 * non segreto necessario per ricevere messaggi e collegare una chat Telegram a
 * una sessione Memora.
 */

/** Utente Telegram autorizzato: l'ID numerico è l'unica identità stabile. */
export interface TelegramAllowedUser {
  /** ID numerico Telegram, conservato come stringa per evitare perdite di precisione. */
  id: string;
  label: string;
  pairedAt: number;
  lastSeenAt?: number;
}

/** Sessione Memora collegata a una chat Telegram. */
export interface TelegramBinding {
  /** Chat Telegram di origine; per una DM coincide con l'utente. */
  chatId: string;
  /** Utente Telegram proprietario del collegamento. */
  userId: string;
  sessionId: string;
  /** Progetto usato per creare la sessione, se presente. */
  projectId?: string;
  /** Profilo agente usato per creare la sessione, se presente. */
  agentProfileId?: string;
  createdAt: number;
  updatedAt: number;
  /** Ultimo turno avviato da Telegram. */
  lastTurnId?: string;
  /** Turno ancora in corso; dopo un riavvio viene marcato interrotto. */
  pendingTurnId?: string;
}

/** Modalità di risposta del bridge. */
export type TelegramReplyMode = 'final' | 'progress';

/** Impostazioni non segrete del bridge per un account. */
export interface TelegramInboundSettings {
  defaultProjectId: string | null;
  defaultAgentProfileId: string | null;
  replyMode: TelegramReplyMode;
  /** Messaggi accodabili per chat; 0 = nessuna coda. */
  maxQueuedMessages: number;
}

/** Vista dello stato di associazione; il codice in chiaro non viene mai salvato. */
export interface TelegramPairingView {
  active: boolean;
  expiresAt?: number;
}

/** Vista amministrativa dell'ingresso Telegram per un account. */
export interface TelegramInboundAccountView {
  accountId: string;
  enabled: boolean;
  allowedUsers: TelegramAllowedUser[];
  bindings: TelegramBinding[];
  settings: TelegramInboundSettings;
  pairing: TelegramPairingView;
  /** Prossimo `update_id` da richiedere a Telegram. */
  offset: number;
}

/** Modifiche amministrative all'ingresso Telegram di un account. */
export interface TelegramInboundPatch {
  enabled?: boolean;
  defaultProjectId?: string | null;
  defaultAgentProfileId?: string | null;
  replyMode?: TelegramReplyMode;
  maxQueuedMessages?: number;
}

/** Codice di associazione restituito una sola volta all'amministratore. */
export interface TelegramPairingCodeView {
  code: string;
  expiresAt: number;
  /** Link `https://t.me/<bot>?start=<code>` quando lo username del bot è noto. */
  deepLink?: string;
}

/** Stato runtime del poller di un account. */
export type TelegramPollerStatus = 'disabled' | 'starting' | 'running' | 'paused' | 'error' | 'conflict';

export interface TelegramInboundStatus {
  accountId: string;
  enabled: boolean;
  status: TelegramPollerStatus;
  botUsername?: string;
  lastUpdateAt?: number;
  lastError?: string;
}

/** Risposta amministrativa con stato persistente e stato runtime del poller. */
export interface TelegramInboundAdminView {
  inbound: TelegramInboundAccountView;
  status: TelegramInboundStatus;
}

/** Input per completare il pairing con un codice monouso. */
export interface TelegramPairingInput {
  code: string;
  userId: string | number;
  label?: string;
  /** Un codice privato non può essere usato in un gruppo e viceversa. */
  scope?: TelegramPairingScope;
}

/** Input per aggiungere manualmente un utente o completare un pairing. */
export interface TelegramAllowedUserInput {
  id: string | number;
  label?: string;
}

export const TELEGRAM_INBOUND_MAX_ALLOWED_USERS = 20;
export const TELEGRAM_PAIRING_TTL_MS = 10 * 60_000;
export const TELEGRAM_PAIRING_MAX_ATTEMPTS = 10;
export const TELEGRAM_INBOUND_MAX_QUEUED_MESSAGES = 5;

export const DEFAULT_TELEGRAM_INBOUND_SETTINGS: Readonly<TelegramInboundSettings> = {
  defaultProjectId: null,
  defaultAgentProfileId: null,
  replyMode: 'final',
  maxQueuedMessages: 1,
};

/** Modalità di condivisione di una chat web verso Telegram. */
export type TelegramShareMode = 'answers' | 'full';

/** Configurazione per-sessione del mirror web → Telegram. */
export interface TelegramShare {
  sessionId: string;
  accountId: string;
  userId: string;
  chatId: string;
  mode: TelegramShareMode;
  includeArtifacts: boolean;
  createdAt: number;
  updatedAt: number;
  /** Ultimo turno web consegnato, per evitare duplicati. */
  lastDeliveredTurnId?: string;
  /** Ultimo errore di consegna, senza contenuto della conversazione. */
  lastError?: string;
}

/** Destinazione Telegram selezionabile dal composer della web UI. */
export interface TelegramShareTarget {
  accountId: string;
  accountLabel: string;
  userId: string;
  userLabel: string;
  chatId: string;
  botUsername?: string;
}

export interface TelegramShareView {
  share: TelegramShare | null;
  targets: TelegramShareTarget[];
}

export interface TelegramSharePatch {
  enabled?: boolean;
  accountId?: string;
  userId?: string;
  mode?: TelegramShareMode;
  includeArtifacts?: boolean;
}

/** Ambito di un codice di associazione. */
export type TelegramPairingScope = 'private' | 'group';

/** Origine del titolo di un topic; il titolo automatico non sovrascrive quello manuale. */
export type TelegramTopicTitleSource = 'auto' | 'manual';

/** Collegamento tra un topic Telegram e una sessione Memora. */
export interface TelegramTopicBinding {
  threadId: string;
  sessionId: string;
  title: string;
  /** Progetto della sessione; assente = nessun progetto esplicito. */
  projectId?: string;
  /** Profilo agente della sessione; assente = profilo predefinito. */
  agentProfileId?: string;
  titleSource: TelegramTopicTitleSource;
  createdAt: number;
  updatedAt: number;
  pendingTurnId?: string;
  lastTurnId?: string;
}

/** Gruppo Telegram forum configurato per Memora. */
export interface TelegramGroup {
  chatId: string;
  title: string;
  isForum: boolean;
  pairedAt: number;
  updatedAt: number;
  allowedUsers: string[];
  defaultProjectId: string | null;
  defaultAgentProfileId: string | null;
  /** Mostra `[Nome progetto]` davanti al titolo dei topic secondari. */
  showProjectInTopicTitle: boolean;
  generalSessionId?: string;
  /** Ultimo turno avviato nel topic General. */
  generalLastTurnId?: string;
  /** Turno del topic General ancora in corso. */
  generalPendingTurnId?: string;
  topics: Record<string, TelegramTopicBinding>;
}

export interface TelegramGroupInput {
  chatId: string;
  title: string;
  isForum: boolean;
  allowedUsers: string[];
  defaultProjectId?: string | null;
  defaultAgentProfileId?: string | null;
  showProjectInTopicTitle?: boolean;
  generalSessionId?: string | null;
}

/** Modifiche alle impostazioni di un gruppo forum. */
export interface TelegramGroupPatch {
  defaultProjectId?: string | null;
  defaultAgentProfileId?: string | null;
  showProjectInTopicTitle?: boolean;
}

export interface TelegramTopicInput {
  threadId: string;
  sessionId: string;
  title: string;
  projectId?: string | null;
  agentProfileId?: string | null;
  titleSource?: TelegramTopicTitleSource;
}

/** Topic restituito da createForumTopic. */
export interface TelegramForumTopic {
  threadId: string;
  name: string;
}

export interface TelegramChatInfo {
  id: string;
  type: string;
  title?: string;
  isForum?: boolean;
  username?: string;
}

export interface TelegramChatMemberInfo {
  status: string;
  canManageTopics?: boolean;
  isMember?: boolean;
}
