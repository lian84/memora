import type { TelegramShare } from '@memora/shared';
import { escapeTelegramHtml, prepareTelegramReply, splitTelegramHtml } from './telegram-format.js';
import type { TelegramShareStore } from './telegram-shares.js';
import type { TelegramBindingStore } from './telegram-bindings.js';
import type { TelegramDocument, TelegramStore } from './telegram.js';
import type { TurnCompletion, TurnStatus } from './turn-manager.js';

export interface TelegramMirrorTransport {
  sendTo(chatId: string, text: string, accountId?: string, options?: { parseMode?: 'HTML' }): Promise<void>;
  sendDocumentTo(chatId: string, document: TelegramDocument, accountId?: string): Promise<void>;
}

export interface TelegramMirrorArtifact {
  id: string;
  name: string;
  kind: string;
  createdAt: number;
}

export interface TelegramMirrorSessionService {
  getSessionMessages(sessionId: string): Promise<Array<{ role: string; content: string }>>;
  listArtifacts(sessionId: string): Promise<TelegramMirrorArtifact[]>;
  getArtifact(sessionId: string, artifactId: string): Promise<{ name: string; mimeType: string; buffer: Buffer }>;
}

export interface TelegramMirrorReads {
  mark(sessionId: string, turnId: string): Promise<void>;
}

export interface TelegramMirrorDeps {
  telegram: TelegramMirrorTransport;
  shares: TelegramShareStore;
  sessions: TelegramMirrorSessionService;
  accounts: TelegramStore;
  bindings: TelegramBindingStore;
  reads?: TelegramMirrorReads;
  log?: (event: string, details?: Record<string, unknown>) => void;
}

const DOCUMENT_KINDS = new Set(['pdf', 'docx', 'xlsx', 'pptx']);

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
}

/**
 * Consegna su Telegram le risposte dei turni avviati dalla web UI quando la
 * sessione ha una condivisione esplicita. I turni Telegram sono ignorati: li
 * consegna già il bridge in ingresso.
 */
export class TelegramMirrorService {
  private readonly telegram: TelegramMirrorTransport;
  private readonly shares: TelegramShareStore;
  private readonly sessions: TelegramMirrorSessionService;
  private readonly accounts: TelegramStore;
  private readonly bindings: TelegramBindingStore;
  private readonly reads?: TelegramMirrorReads;
  private readonly log: (event: string, details?: Record<string, unknown>) => void;
  private readonly queues = new Map<string, Promise<void>>();
  private stopping = false;

  constructor(deps: TelegramMirrorDeps) {
    this.telegram = deps.telegram;
    this.shares = deps.shares;
    this.sessions = deps.sessions;
    this.accounts = deps.accounts;
    this.bindings = deps.bindings;
    this.reads = deps.reads;
    this.log = deps.log ?? (() => undefined);
  }

  /** Accoda la consegna di un turno web completato. Non blocca il TurnManager. */
  onTurnComplete(completion: TurnCompletion): void {
    if (this.stopping || completion.turn.source !== 'web') return;
    const sessionId = completion.turn.sessionId;
    const existing = this.shares.get(sessionId);
    if (!existing) return;
    if (existing.lastDeliveredTurnId === completion.turn.turnId) return;

    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => this.deliver(completion))
      .catch(error => {
        this.log('telegram_mirror_failed', { sessionId, code: errorCode(error) ?? 'internal' });
      })
      .finally(() => {
        if (this.queues.get(sessionId) === task) this.queues.delete(sessionId);
      });
    this.queues.set(sessionId, task);
  }

  isIdle(): boolean {
    return this.queues.size === 0;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...this.queues.values()]),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 5_000); }),
    ]);
    if (timer) clearTimeout(timer);
    this.queues.clear();
  }

  /** Rimuove le condivisioni quando un account Telegram viene eliminato. */
  async removeAccount(accountId: string): Promise<void> {
    await this.shares.removeForAccount(accountId);
  }

  async removeSession(sessionId: string): Promise<void> {
    await this.shares.remove(sessionId);
  }

  private async deliver(completion: TurnCompletion): Promise<void> {
    const share = this.shares.get(completion.turn.sessionId);
    if (!share) return;
    if (share.lastDeliveredTurnId === completion.turn.turnId) return;

    const account = this.accounts.getAccount(share.accountId);
    if (!account || !account.enabled || !account.tokenConfigured) {
      await this.shares.setError(completion.turn.sessionId, 'Account Telegram non attivo o token mancante');
      return;
    }
    if (!this.bindings.isAllowed(share.accountId, share.userId)) {
      await this.shares.setError(completion.turn.sessionId, 'Utente Telegram non più autorizzato');
      return;
    }

    try {
      if (share.mode === 'full' && completion.turn.text?.trim()) {
        await this.sendUserMessage(share, completion.turn.text.trim());
      }
      const status = completion.turn.status;
      if (status === 'completed') {
        let text = completion.text.trim();
        if (!text) text = await this.lastAssistantText(completion.turn.sessionId);
        const answer = text || 'Risposta completata senza testo.';
        const sent = await this.sendAnswer(share, answer);
        const documents = share.includeArtifacts ? await this.sendArtifacts(share, completion) : 0;
        if (sent || documents > 0) {
          await this.markDelivered(share, completion.turn.turnId);
        }
        return;
      }
      const statusText = this.statusNotice(status, completion.turn.error);
      const sent = await this.sendAnswer(share, statusText);
      if (sent) await this.markDelivered(share, completion.turn.turnId);
    } catch (error) {
      const code = errorCode(error) ?? 'internal';
      await this.shares.setError(completion.turn.sessionId, `Invio Telegram non riuscito (${code})`).catch(() => undefined);
      throw error;
    }
  }

  private statusNotice(status: TurnStatus, error?: string): string {
    if (status === 'aborted') return '⏹ **Risposta web interrotta.**';
    if (status === 'interrupted') return '⚠️ **La risposta web è stata interrotta da un riavvio di Memora.**';
    const detail = error ? `\n\n${error}` : '';
    return `⚠️ **La risposta web non è stata completata.**${detail}`;
  }

  private async sendUserMessage(share: TelegramShare, text: string): Promise<void> {
    const html = `<b>👤 Messaggio dalla web UI</b>\n\n${escapeTelegramHtml(text)}`;
    const chunks = splitTelegramHtml(html);
    for (const chunk of chunks) {
      await this.telegram.sendTo(share.chatId, chunk, share.accountId, { parseMode: 'HTML' });
    }
  }

  private async sendAnswer(share: TelegramShare, text: string): Promise<boolean> {
    const prepared = prepareTelegramReply(`💬 **Risposta dalla web UI**\n\n${text}`, { filename: 'risposta-web' });
    let sent = false;
    for (const chunk of prepared.chunks) {
      await this.telegram.sendTo(share.chatId, chunk, share.accountId, { parseMode: 'HTML' });
      sent = true;
    }
    if (prepared.document) {
      await this.telegram.sendDocumentTo(share.chatId, prepared.document, share.accountId);
      sent = true;
    }
    return sent;
  }

  private async sendArtifacts(share: TelegramShare, completion: TurnCompletion): Promise<number> {
    let sent = 0;
    try {
      const artifacts = await this.sessions.listArtifacts(completion.turn.sessionId);
      const selected = artifacts.filter(artifact =>
        DOCUMENT_KINDS.has(artifact.kind) && artifact.createdAt >= completion.turn.createdAt - 1_000);
      for (const artifact of selected) {
        try {
          const full = await this.sessions.getArtifact(completion.turn.sessionId, artifact.id);
          await this.telegram.sendDocumentTo(share.chatId, {
            filename: full.name,
            mimeType: full.mimeType,
            buffer: full.buffer,
          }, share.accountId);
          sent += 1;
        } catch (error) {
          this.log('telegram_mirror_artifact_failed', {
            sessionId: completion.turn.sessionId,
            artifactId: artifact.id,
            code: errorCode(error) ?? 'internal',
          });
        }
      }
    } catch (error) {
      this.log('telegram_mirror_artifact_list_failed', {
        sessionId: completion.turn.sessionId,
        code: errorCode(error) ?? 'internal',
      });
    }
    return sent;
  }

  private async lastAssistantText(sessionId: string): Promise<string> {
    const messages = await this.sessions.getSessionMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === 'assistant' && message.content.trim()) return message.content.trim();
    }
    return '';
  }

  private async markDelivered(share: TelegramShare, turnId: string): Promise<void> {
    await this.shares.markDelivered(share.sessionId, turnId).catch(() => undefined);
    if (this.reads) {
      await this.reads.mark(share.sessionId, turnId).catch(error => {
        this.log('telegram_mirror_read_failed', { sessionId: share.sessionId, code: errorCode(error) ?? 'internal' });
      });
    }
  }
}
