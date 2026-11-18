import type { FastifyInstance } from 'fastify';
import type { ChatAttachmentContext } from '@memora/shared';
import { TurnManager } from './turn-manager.js';

interface TurnRouteDeps {
  turns: TurnManager;
  chatAttachmentStore: {
    loadMany(sessionId: string, ids: string[]): Promise<unknown[]>;
    toModelContext(attachment: unknown): Promise<ChatAttachmentContext>;
  };
  hasSession(sessionId: string): Promise<boolean>;
}

function isTurnForSession(turns: TurnManager, turnId: string, sessionId: string): boolean {
  const turn = turns.getTurn(turnId);
  return turn?.sessionId === sessionId;
}

export function registerTurnRoutes(app: FastifyInstance, deps: TurnRouteDeps): void {
  app.post<{ Params: { id: string }; Body: { text?: unknown; attachmentIds?: unknown } }>('/api/sessions/:id/turns', async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== 'string' || !text.trim()) return reply.status(400).send({ error: 'invalid_message' });
    const attachmentIds = Array.isArray(request.body?.attachmentIds)
      ? request.body.attachmentIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (attachmentIds.length > 8) return reply.status(400).send({ error: 'too_many_attachments' });
    if (!(await deps.hasSession(request.params.id))) return reply.status(404).send({ error: 'session_not_found' });
    try {
      const attachments = await Promise.all((await deps.chatAttachmentStore.loadMany(request.params.id, attachmentIds))
        .map(attachment => deps.chatAttachmentStore.toModelContext(attachment)));
      const turn = deps.turns.start(request.params.id, text, attachments);
      return reply.status(202).send({ turn });
    } catch (error) {
      app.log.error(error, 'turn_start_failed');
      return reply.status(500).send({ error: 'turn_start_failed' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id/turns/current', async (request, reply) => {
    return reply.send({ turn: deps.turns.getCurrent(request.params.id) });
  });

  app.get<{ Params: { id: string; turnId: string }; Querystring: { after?: string } }>('/api/sessions/:id/turns/:turnId/events', async (request, reply) => {
    if (!isTurnForSession(deps.turns, request.params.turnId, request.params.id)) {
      return reply.status(404).send({ error: 'turn_not_found' });
    }
    const after = Number(request.query.after ?? 0);
    const since = Number.isSafeInteger(after) && after >= 0 ? after : 0;
    const turn = deps.turns.getTurn(request.params.turnId);
    if (!turn) return reply.status(404).send({ error: 'turn_not_found' });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    let unsubscribe: (() => void) | null = null;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
    };
    const send = (entry: { seq: number; event: { type: string; payload: unknown } }) => {
      if (closed) return;
      const event = {
        ...entry.event,
        seq: entry.seq,
      };
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (entry.event.type === 'turn_complete') {
        close();
        reply.raw.end();
      }
    };
    unsubscribe = deps.turns.subscribe(request.params.turnId, since, send);
    if (!unsubscribe) {
      close();
      reply.raw.end();
      return reply;
    }
    reply.raw.on('close', close);
    if (turn.status === 'completed' || turn.status === 'failed' || turn.status === 'aborted') {
      close();
      reply.raw.end();
    }
    return reply;
  });

  app.post<{ Params: { id: string; turnId: string } }>('/api/sessions/:id/turns/:turnId/abort', async (request, reply) => {
    if (!isTurnForSession(deps.turns, request.params.turnId, request.params.id)) {
      return reply.status(404).send({ error: 'turn_not_found' });
    }
    const turn = await deps.turns.abort(request.params.turnId);
    return turn ? reply.send({ turn }) : reply.status(404).send({ error: 'turn_not_found' });
  });

  app.get('/api/turns', async (_request, reply) => {
    return reply.send({ turns: deps.turns.list() });
  });
}
