import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TelegramBindingStore } from './telegram-bindings.js';
import { TelegramInboundError } from './telegram-bindings.js';
import type { TelegramStore } from './telegram.js';
import type { TelegramGroupStore } from './telegram-groups.js';
import { TelegramGroupError } from './telegram-groups.js';

export interface TelegramGroupRoutesDeps {
  accounts: TelegramStore;
  bindings: TelegramBindingStore;
  groups: TelegramGroupStore;
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof TelegramGroupError || error instanceof TelegramInboundError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}

export function registerTelegramGroupRoutes(app: FastifyInstance, deps: TelegramGroupRoutesDeps): void {
  app.get<{ Params: { id: string } }>('/api/admin/telegram/accounts/:id/groups', async (request, reply) => {
    if (!deps.accounts.getAccount(request.params.id)) return reply.status(404).send({ error: 'telegram_account_not_found' });
    return reply.send({ groups: deps.groups.list(request.params.id) });
  });

  app.post<{ Params: { id: string } }>('/api/admin/telegram/accounts/:id/groups/pairing', async (request, reply) => {
    const account = deps.accounts.getAccount(request.params.id);
    if (!account) return reply.status(404).send({ error: 'telegram_account_not_found' });
    if (!account.tokenConfigured) return reply.status(409).send({ error: 'telegram_not_configured' });
    try {
      const pairing = await deps.bindings.createPairingCode(account.id, 'group');
      return reply.status(201).send({ pairing });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string; chatId: string } }>('/api/admin/telegram/accounts/:id/groups/:chatId', async (request, reply) => {
    if (!deps.accounts.getAccount(request.params.id)) return reply.status(404).send({ error: 'telegram_account_not_found' });
    try {
      return reply.send({ removed: await deps.groups.removeGroup(request.params.id, request.params.chatId) });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
