import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TelegramShareMode, TelegramShareTarget, TelegramShareView } from '@memora/shared';
import type { TelegramAccountView } from '@memora/shared';
import type { TelegramBindingStore } from './telegram-bindings.js';
import { TelegramInboundError } from './telegram-bindings.js';
import type { TelegramStore } from './telegram.js';
import type { TelegramInboundService } from './telegram-inbound.js';
import type { TelegramShareStore } from './telegram-shares.js';
import { TelegramShareError } from './telegram-shares.js';

export interface TelegramShareRoutesDeps {
  accounts: TelegramStore;
  bindings: TelegramBindingStore;
  shares: TelegramShareStore;
  inbound: TelegramInboundService;
  sessions: { hasSession(sessionId: string): Promise<boolean> };
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof TelegramShareError || error instanceof TelegramInboundError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}

function targetKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`;
}

function buildTargets(deps: TelegramShareRoutesDeps): TelegramShareTarget[] {
  const targets = new Map<string, TelegramShareTarget>();
  for (const account of deps.accounts.listAccounts()) {
    if (!account.enabled || !account.tokenConfigured) continue;
    const incoming = deps.bindings.get(account.id);
    const botUsername = deps.inbound.getStatus(account.id).botUsername;
    for (const binding of incoming.bindings) {
      const user = incoming.allowedUsers.find(item => item.id === binding.userId);
      if (!user) continue;
      const target: TelegramShareTarget = {
        accountId: account.id,
        accountLabel: account.label,
        userId: user.id,
        userLabel: user.label,
        chatId: binding.chatId,
        ...(botUsername ? { botUsername } : {}),
      };
      targets.set(targetKey(account.id, user.id), target);
    }
    if (account.chatId && /^\d{1,20}$/.test(account.chatId)) {
      const user = incoming.allowedUsers.find(item => item.id === account.chatId);
      if (user) {
        targets.set(targetKey(account.id, user.id), {
          accountId: account.id,
          accountLabel: account.label,
          userId: user.id,
          userLabel: user.label,
          chatId: account.chatId,
          ...(botUsername ? { botUsername } : {}),
        });
      }
    }
  }
  return [...targets.values()].sort((a, b) =>
    a.accountLabel.localeCompare(b.accountLabel, 'it') || a.userLabel.localeCompare(b.userLabel, 'it'));
}

function resolveTarget(deps: TelegramShareRoutesDeps, accountId: string, userId: string): { account: TelegramAccountView; chatId: string } {
  const account = deps.accounts.getAccount(accountId);
  if (!account) throw new TelegramShareError('telegram_account_not_found', 'Account Telegram non trovato', 404);
  if (!account.enabled) throw new TelegramShareError('telegram_account_disabled', 'Account Telegram disattivato', 409);
  if (!account.tokenConfigured) throw new TelegramShareError('telegram_not_configured', 'Token Telegram non configurato', 409);
  if (!deps.bindings.isAllowed(accountId, userId)) {
    throw new TelegramShareError('telegram_user_not_allowed', 'Utente Telegram non autorizzato', 403);
  }
  const binding = deps.bindings.getBinding(accountId, userId);
  if (binding) return { account, chatId: binding.chatId };
  if (account.chatId && account.chatId === userId) return { account, chatId: account.chatId };
  throw new TelegramShareError('telegram_share_target_unavailable', 'La chat Telegram non è ancora collegata a una sessione', 409);
}

function view(deps: TelegramShareRoutesDeps, sessionId: string): TelegramShareView {
  return {
    share: deps.shares.get(sessionId) ?? null,
    targets: buildTargets(deps),
  };
}

export function registerTelegramShareRoutes(app: FastifyInstance, deps: TelegramShareRoutesDeps): void {
  app.get<{ Params: { id: string } }>('/api/sessions/:id/telegram-share', async (request, reply) => {
    if (!(await deps.sessions.hasSession(request.params.id))) return reply.status(404).send({ error: 'session_not_found' });
    return reply.send(view(deps, request.params.id));
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> | undefined }>('/api/sessions/:id/telegram-share', async (request, reply) => {
    const sessionId = request.params.id;
    if (!(await deps.sessions.hasSession(sessionId))) return reply.status(404).send({ error: 'session_not_found' });
    const body = request.body ?? {};
    try {
      if (Object.prototype.hasOwnProperty.call(body, 'enabled') && typeof body.enabled !== 'boolean') {
        throw new TelegramShareError('invalid_telegram_share', 'Stato condivisione Telegram non valido');
      }
      if (body.mode !== undefined && body.mode !== 'answers' && body.mode !== 'full') {
        throw new TelegramShareError('invalid_telegram_share_mode', 'Modalità di condivisione Telegram non valida');
      }
      if (body.enabled === false) {
        await deps.shares.remove(sessionId);
        return reply.send(view(deps, sessionId));
      }
      const existing = deps.shares.get(sessionId);
      const accountId = typeof body.accountId === 'string' ? body.accountId : existing?.accountId;
      const userId = typeof body.userId === 'string' ? body.userId : existing?.userId;
      if (!accountId || !userId) {
        throw new TelegramShareError('telegram_share_target_required', 'Scegli una destinazione Telegram');
      }
      const target = resolveTarget(deps, accountId, userId);
      const mode: TelegramShareMode = body.mode === 'full' ? 'full' : body.mode === 'answers' ? 'answers' : existing?.mode ?? 'answers';
      const includeArtifacts = typeof body.includeArtifacts === 'boolean' ? body.includeArtifacts : existing?.includeArtifacts ?? true;
      await deps.shares.set(sessionId, {
        accountId,
        userId,
        chatId: target.chatId,
        mode,
        includeArtifacts,
      });
      if (mode === 'full') {
        // La modalità completa è bidirezionale: questa chat deve essere la
        // sessione attiva del binding Telegram per ricevere le risposte.
        await deps.bindings.setBinding(accountId, {
          userId,
          chatId: target.chatId,
          sessionId,
        });
      }
      return reply.send(view(deps, sessionId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
