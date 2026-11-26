import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TelegramGroupPatch } from '@memora/shared';
import type { TelegramBindingStore } from './telegram-bindings.js';
import { TelegramInboundError } from './telegram-bindings.js';
import { TelegramError, type TelegramStore } from './telegram.js';
import type { TelegramGroupStore } from './telegram-groups.js';
import { TelegramGroupError } from './telegram-groups.js';
import type { TelegramInboundService } from './telegram-inbound.js';

export interface TelegramGroupRoutesDeps {
  accounts: TelegramStore;
  bindings: TelegramBindingStore;
  groups: TelegramGroupStore;
  inbound?: Pick<TelegramInboundService, 'syncGroupTopicTitles'>;
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof TelegramGroupError || error instanceof TelegramInboundError || error instanceof TelegramError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  if (error instanceof Error && error.message === 'group_not_found') {
    return reply.status(404).send({ error: 'telegram_group_not_found', message: error.message });
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

  app.patch<{ Params: { id: string; chatId: string }; Body: Record<string, unknown> | undefined }>('/api/admin/telegram/accounts/:id/groups/:chatId', async (request, reply) => {
    if (!deps.accounts.getAccount(request.params.id)) return reply.status(404).send({ error: 'telegram_account_not_found' });
    const body = request.body ?? {};
    const patch: TelegramGroupPatch = {};
    if (Object.prototype.hasOwnProperty.call(body, 'defaultProjectId')) {
      if (body.defaultProjectId !== null && typeof body.defaultProjectId !== 'string') {
        return reply.status(400).send({ error: 'invalid_telegram_project_id', message: 'Progetto Telegram non valido' });
      }
      patch.defaultProjectId = body.defaultProjectId === null || body.defaultProjectId === '' ? null : body.defaultProjectId;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'defaultAgentProfileId')) {
      if (body.defaultAgentProfileId !== null && typeof body.defaultAgentProfileId !== 'string') {
        return reply.status(400).send({ error: 'invalid_telegram_agent_profile_id', message: 'Profilo agente Telegram non valido' });
      }
      patch.defaultAgentProfileId = body.defaultAgentProfileId === null || body.defaultAgentProfileId === '' ? null : body.defaultAgentProfileId;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'showProjectInTopicTitle')) {
      if (typeof body.showProjectInTopicTitle !== 'boolean') {
        return reply.status(400).send({ error: 'invalid_telegram_topic_title', message: 'Impostazione titolo topic non valida' });
      }
      patch.showProjectInTopicTitle = body.showProjectInTopicTitle;
    }
    try {
      return reply.send({ group: await deps.groups.updateSettings(request.params.id, request.params.chatId, patch) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string; chatId: string } }>('/api/admin/telegram/accounts/:id/groups/:chatId/topics/resync', async (request, reply) => {
    if (!deps.accounts.getAccount(request.params.id)) return reply.status(404).send({ error: 'telegram_account_not_found' });
    if (!deps.inbound) return reply.status(503).send({ error: 'telegram_inbound_unavailable' });
    try {
      return reply.send(await deps.inbound.syncGroupTopicTitles(request.params.id, request.params.chatId));
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
