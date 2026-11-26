import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TelegramInboundPatch } from '@memora/shared';
import type { TelegramBindingStore } from './telegram-bindings.js';
import { TelegramInboundError } from './telegram-bindings.js';
import { TelegramError, type TelegramStore } from './telegram.js';
import type { TelegramInboundService } from './telegram-inbound.js';
import type { TelegramShareStore } from './telegram-shares.js';

export interface TelegramInboundRoutesDeps {
  accounts: TelegramStore;
  bindings: TelegramBindingStore;
  inbound: TelegramInboundService;
  shares?: TelegramShareStore;
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof TelegramInboundError || error instanceof TelegramError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function patchFromBody(body: Record<string, unknown>): TelegramInboundPatch {
  const patch: TelegramInboundPatch = {};
  if (has(body, 'enabled')) {
    if (typeof body.enabled !== 'boolean') throw new TelegramInboundError('invalid_telegram_inbound', 'Stato ingresso non valido');
    patch.enabled = body.enabled;
  }
  if (has(body, 'defaultProjectId')) {
    const value = body.defaultProjectId;
    if (value !== null && value !== undefined && typeof value !== 'string') {
      throw new TelegramInboundError('invalid_telegram_project_id', 'Progetto Telegram non valido');
    }
    patch.defaultProjectId = value === null || value === undefined || value === '' ? null : value;
  }
  if (has(body, 'defaultAgentProfileId')) {
    const value = body.defaultAgentProfileId;
    if (value !== null && value !== undefined && typeof value !== 'string') {
      throw new TelegramInboundError('invalid_telegram_agent_profile_id', 'Profilo agente Telegram non valido');
    }
    patch.defaultAgentProfileId = value === null || value === undefined || value === '' ? null : value;
  }
  if (has(body, 'replyMode')) {
    if (body.replyMode !== 'final' && body.replyMode !== 'progress') {
      throw new TelegramInboundError('invalid_telegram_reply_mode', 'Modalità di risposta Telegram non valida');
    }
    patch.replyMode = body.replyMode;
  }
  if (has(body, 'maxQueuedMessages')) {
    if (typeof body.maxQueuedMessages !== 'number') {
      throw new TelegramInboundError('invalid_telegram_queue_size', 'Dimensione coda Telegram non valida');
    }
    patch.maxQueuedMessages = body.maxQueuedMessages;
  }
  return patch;
}

export function registerTelegramInboundRoutes(app: FastifyInstance, deps: TelegramInboundRoutesDeps): void {
  app.get<{ Params: { id: string } }>('/api/admin/telegram/accounts/:id/inbound', async (request, reply) => {
    if (!deps.accounts.getAccount(request.params.id)) return reply.status(404).send({ error: 'telegram_account_not_found' });
    return reply.send({
      inbound: deps.bindings.get(request.params.id),
      status: deps.inbound.getStatus(request.params.id),
    });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> | undefined }>('/api/admin/telegram/accounts/:id/inbound', async (request, reply) => {
    if (!deps.accounts.getAccount(request.params.id)) return reply.status(404).send({ error: 'telegram_account_not_found' });
    try {
      const patch = patchFromBody(request.body ?? {});
      const inbound = await deps.bindings.update(request.params.id, patch);
      if (patch.enabled !== undefined) await deps.inbound.refreshAccount(request.params.id);
      return reply.send({ inbound, status: deps.inbound.getStatus(request.params.id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/admin/telegram/accounts/:id/inbound/pairing', async (request, reply) => {
    if (!deps.accounts.getAccount(request.params.id)) return reply.status(404).send({ error: 'telegram_account_not_found' });
    try {
      return reply.status(201).send({ pairing: await deps.inbound.createPairingCode(request.params.id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/admin/telegram/accounts/:id/inbound/pairing', async (request, reply) => {
    if (!deps.accounts.getAccount(request.params.id)) return reply.status(404).send({ error: 'telegram_account_not_found' });
    try {
      await deps.inbound.clearPairingCode(request.params.id);
      return reply.send({
        inbound: deps.bindings.get(request.params.id),
        status: deps.inbound.getStatus(request.params.id),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string }; Body: { id?: unknown; label?: unknown } | undefined }>('/api/admin/telegram/accounts/:id/inbound/users', async (request, reply) => {
    if (!deps.accounts.getAccount(request.params.id)) return reply.status(404).send({ error: 'telegram_account_not_found' });
    try {
      const user = await deps.bindings.addAllowedUser(request.params.id, {
        id: (request.body?.id ?? '') as string | number,
        ...(typeof request.body?.label === 'string' ? { label: request.body.label } : {}),
      });
      return reply.status(201).send({ user });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string; userId: string } }>('/api/admin/telegram/accounts/:id/inbound/users/:userId', async (request, reply) => {
    if (!deps.accounts.getAccount(request.params.id)) return reply.status(404).send({ error: 'telegram_account_not_found' });
    try {
      const removed = await deps.bindings.removeAllowedUser(request.params.id, request.params.userId);
      if (removed) await deps.shares?.removeForUser(request.params.id, request.params.userId);
      return reply.send({ removed });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string; userId: string } }>('/api/admin/telegram/accounts/:id/inbound/bindings/:userId', async (request, reply) => {
    if (!deps.accounts.getAccount(request.params.id)) return reply.status(404).send({ error: 'telegram_account_not_found' });
    try {
      return reply.send({ removed: await deps.bindings.removeBinding(request.params.id, request.params.userId) });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
