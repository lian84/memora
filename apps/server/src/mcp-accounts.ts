import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { isMcpServerId, type McpAccount, type McpAccountScope, type McpServerId } from '@memora/shared';
import { McpSecretStore } from './mcp-secrets.js';

const ACCOUNT_ID = /^acc_[a-z0-9][a-z0-9_-]{2,63}$/;
const SECRET_REF = /^(?:env:[A-Z_][A-Z0-9_]*|secret:[a-z0-9][a-z0-9:._-]{1,160})$/;

interface AccountFile {
  version: 1;
  accounts: McpAccount[];
}

export class McpAccountError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'McpAccountError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Registry centrale degli account MCP globali e project-scoped. I token non stanno qui. */
export class McpAccountStore {
  private readonly filePath: string;
  private readonly configDir: string;
  private accounts = new Map<string, McpAccount>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.configDir = path.join(dataDir, 'config');
    this.filePath = path.join(this.configDir, 'mcp-accounts.json');
  }

  async initialize(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown;
      if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.accounts)) throw new Error('invalid');
      for (const item of raw.accounts) {
        const account = this.validateRecord(item);
        if (account) this.accounts.set(account.id, account);
      }
      await fs.chmod(this.filePath, 0o600).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new McpAccountError('invalid_mcp_accounts', 'Registry account MCP non leggibile');
    }
    this.loaded = true;
  }

  async list(projectId?: string): Promise<McpAccount[]> {
    await this.initialize();
    return [...this.accounts.values()]
      .filter(account => projectId === undefined || (account.scope === 'global' || account.projectId === projectId))
      .sort((a, b) => a.serverId.localeCompare(b.serverId) || a.label.localeCompare(b.label, 'it'));
  }

  async get(id: string): Promise<McpAccount | null> {
    await this.initialize();
    return this.accounts.get(id) ?? null;
  }

  async create(input: unknown): Promise<McpAccount> {
    await this.initialize();
    if (!isRecord(input)) throw new McpAccountError('invalid_mcp_account', 'Dati account MCP non validi');
    const serverId = input.serverId;
    if (!isMcpServerId(serverId)) throw new McpAccountError('invalid_mcp_server', 'Server MCP non supportato');
    const scope: McpAccountScope = input.scope === 'project' ? 'project' : 'global';
    const projectId = scope === 'project' ? this.cleanProjectId(input.projectId) : undefined;
    const label = this.cleanLabel(input.label);
    const secretRef = this.cleanSecretRef(input.secretRef);
    const requestedId = typeof input.id === 'string' ? input.id.trim() : '';
    const id = requestedId || `acc_${serverId}_${crypto.randomUUID().slice(0, 8)}`;
    if (!ACCOUNT_ID.test(id)) throw new McpAccountError('invalid_mcp_account_id', 'ID account MCP non valido');
    if (this.accounts.has(id)) throw new McpAccountError('mcp_account_exists', 'Account MCP già esistente', 409);
    const now = Date.now();
    const account: McpAccount = {
      id, serverId, label, scope, ...(projectId ? { projectId } : {}), secretRef,
      defaultForServer: scope === 'global' && input.defaultForServer === true,
      createdAt: now, updatedAt: now,
    };
    this.accounts.set(id, account);
    this.applyDefault(account);
    await this.persist();
    return account;
  }

  async update(id: string, patch: unknown): Promise<McpAccount> {
    await this.initialize();
    const current = this.accounts.get(id);
    if (!current) throw new McpAccountError('mcp_account_not_found', 'Account MCP non trovato', 404);
    if (!isRecord(patch)) throw new McpAccountError('invalid_mcp_account', 'Patch account MCP non valida');
    const allowed = new Set(['label', 'secretRef', 'defaultForServer']);
    for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new McpAccountError('invalid_mcp_account_field', `Campo account non modificabile: ${key}`);
    const next: McpAccount = {
      ...current,
      ...(patch.label !== undefined ? { label: this.cleanLabel(patch.label) } : {}),
      ...(patch.secretRef !== undefined ? { secretRef: this.cleanSecretRef(patch.secretRef) } : {}),
      ...(patch.defaultForServer !== undefined ? { defaultForServer: current.scope === 'global' && patch.defaultForServer === true } : {}),
      updatedAt: Date.now(),
    };
    this.accounts.set(id, next);
    this.applyDefault(next);
    await this.persist();
    return next;
  }

  async delete(id: string, confirm: string): Promise<{ id: string }> {
    await this.initialize();
    if (confirm !== id) throw new McpAccountError('invalid_mcp_account_confirmation', 'Conferma account non valida');
    if (!this.accounts.has(id)) throw new McpAccountError('mcp_account_not_found', 'Account MCP non trovato', 404);
    this.accounts.delete(id);
    await this.persist();
    return { id };
  }

  private applyDefault(account: McpAccount): void {
    if (!account.defaultForServer) return;
    for (const [id, item] of this.accounts) {
      if (id !== account.id && item.serverId === account.serverId && item.scope === 'global' && item.defaultForServer) {
        this.accounts.set(id, { ...item, defaultForServer: false, updatedAt: Date.now() });
      }
    }
  }

  private validateRecord(value: unknown): McpAccount | null {
    if (!isRecord(value)) return null;
    if (typeof value.id !== 'string' || !ACCOUNT_ID.test(value.id)) return null;
    if (!isMcpServerId(value.serverId)) return null;
    if (value.scope !== 'global' && value.scope !== 'project') return null;
    if (value.scope === 'project' && (typeof value.projectId !== 'string' || !value.projectId)) return null;
    if (typeof value.label !== 'string' || !value.label.trim()) return null;
    if (typeof value.secretRef !== 'string' || !SECRET_REF.test(value.secretRef)) return null;
    return {
      id: value.id,
      serverId: value.serverId,
      label: value.label.trim().slice(0, 120),
      scope: value.scope,
      ...(value.scope === 'project' ? { projectId: String(value.projectId) } : {}),
      secretRef: value.secretRef,
      defaultForServer: value.scope === 'global' && value.defaultForServer === true,
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    };
  }

  private cleanLabel(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new McpAccountError('invalid_mcp_account_label', 'Nome account MCP non valido');
    return value.trim();
  }

  private cleanSecretRef(value: unknown): string {
    if (typeof value !== 'string' || !SECRET_REF.test(value)) {
      throw new McpAccountError('invalid_mcp_secret_ref', 'Usa env:NOME_VARIABILE oppure secret:chiave');
    }
    return value;
  }

  private cleanProjectId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new McpAccountError('invalid_project_id', 'Progetto non valido');
    return value;
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
      const payload: AccountFile = { version: 1, accounts: [...this.accounts.values()] };
      const temporary = path.join(this.configDir, `.mcp-accounts.${process.pid}.${Date.now()}.tmp`);
      await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    });
    return this.writeChain;
  }
}

async function resolveSecret(account: McpAccount, secrets: McpSecretStore): Promise<string | undefined> {
  if (account.secretRef.startsWith('env:')) {
    const value = process.env[account.secretRef.slice(4)];
    return value && value.length > 0 ? value : undefined;
  }
  if (account.secretRef.startsWith('secret:')) {
    return secrets.get(account.id);
  }
  return undefined;
}

async function testProvider(serverId: McpServerId, token: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = serverId === 'notion'
      ? await fetch('https://api.notion.com/v1/users/me', {
          headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
          signal: controller.signal,
        })
      : await fetch('https://api.todoist.com/rest/v2/projects', {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
    if (!response.ok) throw new McpAccountError('mcp_connection_failed', `Il servizio ha risposto ${response.status}`);
  } catch (error) {
    if (error instanceof McpAccountError) throw error;
    throw new McpAccountError('mcp_connection_failed', 'Connessione al servizio non riuscita');
  } finally {
    clearTimeout(timeout);
  }
}

export function registerMcpAccountRoutes(app: FastifyInstance, deps: { accounts: McpAccountStore; secrets: McpSecretStore }): void {
  const sendError = (reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown) => {
    if (error instanceof McpAccountError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    return reply.status(500).send({ error: 'mcp_accounts_failed' });
  };

  const configured = async (account: McpAccount): Promise<McpAccount> => ({
    ...account,
    configured: Boolean(await resolveSecret(account, deps.secrets)),
  });

  app.get<{ Querystring: { projectId?: string } }>('/api/admin/mcp/accounts', async (request, reply) => {
    try {
      const projectId = request.query.projectId;
      if (projectId !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(projectId)) return reply.status(400).send({ error: 'invalid_project_id' });
      const accounts = await deps.accounts.list(projectId);
      return reply.send({ accounts: await Promise.all(accounts.map(configured)) });
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Body: unknown }>('/api/admin/mcp/accounts', async (request, reply) => {
    try {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new McpAccountError('invalid_mcp_account', 'Dati account MCP non validi');
      const body = request.body as Record<string, unknown>;
      const token = typeof body.token === 'string' ? body.token : '';
      const input = { ...body };
      delete input.token;
      const advancedSecretRef = typeof input.secretRef === 'string' && input.secretRef.trim() ? input.secretRef.trim() : `secret:mcp:${crypto.randomUUID().slice(0, 8)}`;
      const account = await deps.accounts.create({ ...input, secretRef: advancedSecretRef });
      try {
        if (token) {
          await deps.secrets.set(account.id, token);
          const updated = await deps.accounts.update(account.id, { secretRef: `secret:mcp:${account.id}` });
          return reply.status(201).send({ account: await configured(updated) });
        }
        return reply.status(201).send({ account: await configured(account) });
      } catch (error) {
        await deps.accounts.delete(account.id, account.id).catch(() => undefined);
        await deps.secrets.delete(account.id).catch(() => undefined);
        throw error;
      }
    } catch (error) { return sendError(reply, error); }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/api/admin/mcp/accounts/:id', async (request, reply) => {
    try {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new McpAccountError('invalid_mcp_account', 'Patch account MCP non valida');
      const body = request.body as Record<string, unknown>;
      const token = typeof body.token === 'string' ? body.token : '';
      const input = { ...body };
      delete input.token;
      if (token) {
        await deps.secrets.set(request.params.id, token);
        input.secretRef = `secret:mcp:${request.params.id}`;
      }
      const account = await deps.accounts.update(request.params.id, input);
      return reply.send({ account: await configured(account) });
    } catch (error) { return sendError(reply, error); }
  });

  app.delete<{ Params: { id: string }; Querystring: { confirm?: string } }>('/api/admin/mcp/accounts/:id', async (request, reply) => {
    try {
      if (!request.query.confirm) return reply.status(400).send({ error: 'invalid_mcp_account_confirmation' });
      const result = await deps.accounts.delete(request.params.id, request.query.confirm);
      await deps.secrets.delete(request.params.id).catch(() => undefined);
      return reply.send(result);
    } catch (error) { return sendError(reply, error); }
  });

  app.post<{ Body: unknown }>('/api/admin/mcp/accounts/test', async (request, reply) => {
    try {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new McpAccountError('invalid_mcp_account', 'Dati test non validi');
      const body = request.body as Record<string, unknown>;
      const serverId = body.serverId;
      if (!isMcpServerId(serverId)) throw new McpAccountError('invalid_mcp_server', 'Server MCP non supportato');
      let token = typeof body.token === 'string' ? body.token.trim() : '';
      if (!token && typeof body.accountId === 'string') {
        const account = await deps.accounts.get(body.accountId);
        if (!account) throw new McpAccountError('mcp_account_not_found', 'Account MCP non trovato', 404);
        token = (await resolveSecret(account, deps.secrets)) ?? '';
      }
      if (!token) throw new McpAccountError('missing_mcp_token', 'Inserisci un token o salva l’account prima del test');
      await testProvider(serverId, token);
      return reply.send({ ok: true });
    } catch (error) { return sendError(reply, error); }
  });
}
