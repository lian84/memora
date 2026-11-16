import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import { AuthStore, AUTH_COOKIE } from './auth.js';
import { registerAuthGuard, registerAuthRoutes } from './auth-routes.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-auth-'));
  roots.push(root);
  return { root, store: new AuthStore(root) };
}

describe('AuthStore', () => {
  it('configura la prima password e verifica la sessione', async () => {
    const { root, store } = await fixture();
    await store.load();
    expect(store.setupRequired).toBe(true);
    await expect(store.setup('short')).rejects.toMatchObject({ code: 'invalid_password' });
    await store.setup('una-password-molto-lunga');
    expect(store.setupRequired).toBe(false);
    await expect(store.setup('altra-password-lunga')).rejects.toMatchObject({ code: 'auth_already_configured' });
    expect(await store.verifyPassword('una-password-molto-lunga')).toBe(true);
    expect(await store.verifyPassword('sbagliata')).toBe(false);
    const token = store.createSession();
    expect(store.verifySession(token)).toBe(true);
    expect(store.verifySession(`${token}x`)).toBe(false);
    expect((await fs.stat(path.join(root, 'config', 'auth.json'))).mode & 0o777).toBe(0o600);
  });

  it('invalida le sessioni con reset e logout', async () => {
    const { store } = await fixture();
    await store.load();
    await store.setup('una-password-molto-lunga');
    const token = store.createSession();
    await store.resetPassword('nuova-password-lunga');
    expect(store.verifySession(token)).toBe(false);
    const next = store.createSession();
    expect(store.verifySession(next)).toBe(true);
    await store.logout();
    expect(store.verifySession(next)).toBe(false);
  });

  it('rifiuta un file di autenticazione corrotto', async () => {
    const { root, store } = await fixture();
    await fs.mkdir(path.join(root, 'config'), { recursive: true });
    await fs.writeFile(path.join(root, 'config', 'auth.json'), '{bad');
    await expect(store.load()).rejects.toMatchObject({ code: 'invalid_auth_store' });
  });
});

describe('auth routes', () => {
  it('blocca le API finché non viene impostata la password', async () => {
    const { store } = await fixture();
    await store.load();
    const app = fastify();
    registerAuthGuard(app, { store, secureCookie: false });
    registerAuthRoutes(app, { store, secureCookie: false });
    app.get('/api/private', async () => ({ ok: true }));
    try {
      const setup = await app.inject({ method: 'GET', url: '/api/auth/status' });
      expect(setup.json()).toEqual({ setupRequired: true, authenticated: false });
      const blocked = await app.inject({ method: 'GET', url: '/api/private' });
      expect(blocked.statusCode).toBe(503);
      const created = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'una-password-molto-lunga' } });
      expect(created.statusCode).toBe(201);
      const cookie = String(created.headers['set-cookie']).split(';')[0]!;
      expect(cookie.startsWith(`${AUTH_COOKIE}=`)).toBe(true);
      const allowed = await app.inject({ method: 'GET', url: '/api/private', headers: { cookie } });
      expect(allowed.statusCode).toBe(200);
      const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
      expect(logout.statusCode).toBe(200);
      const after = await app.inject({ method: 'GET', url: '/api/private', headers: { cookie } });
      expect(after.statusCode).toBe(401);
      const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'password-sbagliata' } });
      expect(wrong.statusCode).toBe(401);
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'una-password-molto-lunga' } });
      expect(login.statusCode).toBe(200);
      const loginCookie = String(login.headers['set-cookie']).split(';')[0]!;
      const reopened = await app.inject({ method: 'GET', url: '/api/private', headers: { cookie: loginCookie } });
      expect(reopened.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
