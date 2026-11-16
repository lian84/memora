import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AUTH_COOKIE, AUTH_COOKIE_MAX_AGE_SECONDS, AuthError, type AuthStore } from './auth.js';

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/logout',
]);
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface AuthDependencies {
  store: AuthStore;
  secureCookie: boolean;
}

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function sessionCookie(token: string, secure: boolean, maxAge = AUTH_COOKIE_MAX_AGE_SECONDS): string {
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function sameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function isWriteMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function errorCode(error: unknown): string | null {
  if (error instanceof AuthError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code?: unknown }).code);
  return null;
}

class LoginLimiter {
  private readonly entries = new Map<string, { failures: number; blockedUntil: number; firstFailureAt: number }>();

  check(ip: string): number {
    const entry = this.entries.get(ip);
    if (!entry) return 0;
    if (entry.blockedUntil > Date.now()) return entry.blockedUntil - Date.now();
    if (Date.now() - entry.firstFailureAt > WINDOW_MS) {
      this.entries.delete(ip);
      return 0;
    }
    return 0;
  }

  fail(ip: string): void {
    const now = Date.now();
    const current = this.entries.get(ip);
    if (!current || now - current.firstFailureAt > WINDOW_MS) {
      this.entries.set(ip, { failures: 1, blockedUntil: 0, firstFailureAt: now });
      return;
    }
    const failures = current.failures + 1;
    this.entries.set(ip, {
      failures,
      blockedUntil: failures >= MAX_FAILURES ? now + WINDOW_MS : 0,
      firstFailureAt: current.firstFailureAt,
    });
  }

  clear(ip: string): void {
    this.entries.delete(ip);
  }
}

export function registerAuthGuard(app: FastifyInstance, deps: AuthDependencies): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return;
    if (isWriteMethod(request.method) && !sameOrigin(request)) {
      return reply.status(403).send({ error: 'invalid_origin' });
    }
    if (PUBLIC_PATHS.has(path)) return;
    if (deps.store.setupRequired) return reply.status(503).send({ error: 'setup_required' });
    const token = cookieValue(request, AUTH_COOKIE);
    if (!deps.store.verifySession(token)) return reply.status(401).send({ error: 'authentication_required' });
  });
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDependencies): void {
  const limiter = new LoginLimiter();
  const secureCookie = deps.secureCookie;

  app.get('/api/auth/status', async (request, reply) => {
    const token = cookieValue(request, AUTH_COOKIE);
    return reply.send({
      setupRequired: deps.store.setupRequired,
      authenticated: !deps.store.setupRequired && deps.store.verifySession(token),
    });
  });

  app.post<{ Body: { password?: unknown } }>('/api/auth/setup', async (request, reply) => {
    try {
      if (!deps.store.setupRequired) return reply.status(409).send({ error: 'auth_already_configured' });
      const ip = request.ip;
      const blocked = limiter.check(ip);
      if (blocked > 0) return reply.header('Retry-After', Math.ceil(blocked / 1000)).status(429).send({ error: 'too_many_attempts' });
      if (typeof request.body?.password !== 'string') return reply.status(400).send({ error: 'invalid_password' });
      try {
        await deps.store.setup(request.body.password);
      } catch (error) {
        if (errorCode(error) === 'invalid_password') return reply.status(400).send({ error: 'invalid_password' });
        if (errorCode(error) === 'auth_already_configured') return reply.status(409).send({ error: 'auth_already_configured' });
        throw error;
      }
      limiter.clear(ip);
      reply.header('Set-Cookie', sessionCookie(deps.store.createSession(), secureCookie));
      return reply.status(201).send({ authenticated: true });
    } catch (error) {
      app.log.error({ error: errorCode(error) }, 'auth setup failed');
      return reply.status(500).send({ error: 'auth_setup_failed' });
    }
  });

  app.post<{ Body: { password?: unknown } }>('/api/auth/login', async (request, reply) => {
    try {
      if (deps.store.setupRequired) return reply.status(503).send({ error: 'setup_required' });
      const ip = request.ip;
      const blocked = limiter.check(ip);
      if (blocked > 0) return reply.header('Retry-After', Math.ceil(blocked / 1000)).status(429).send({ error: 'too_many_attempts' });
      if (typeof request.body?.password !== 'string' || !(await deps.store.verifyPassword(request.body.password))) {
        limiter.fail(ip);
        return reply.status(401).send({ error: 'invalid_credentials' });
      }
      limiter.clear(ip);
      reply.header('Set-Cookie', sessionCookie(deps.store.createSession(), secureCookie));
      return reply.send({ authenticated: true });
    } catch (error) {
      app.log.error({ error: errorCode(error) }, 'auth login failed');
      return reply.status(500).send({ error: 'auth_login_failed' });
    }
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    try {
      await deps.store.logout();
    } catch (error) {
      app.log.error({ error: errorCode(error) }, 'auth logout failed');
    }
    reply.header('Set-Cookie', sessionCookie('', secureCookie, 0));
    return reply.send({ authenticated: false });
  });
}
