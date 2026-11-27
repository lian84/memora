import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fastify from 'fastify';
import { registerWebStatic } from './web-static.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-web-static-'));
  dirs.push(dir);
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), '<html><body>old</body></html>');
  await fs.writeFile(path.join(dir, 'assets', 'old.js'), 'console.log("old")');
  const app = fastify();
  await registerWebStatic(app, dir);
  return { app, dir };
}

describe('production web static', () => {
  it('serve un asset aggiunto dopo la registrazione', async () => {
    const { app, dir } = await fixture();
    await fs.writeFile(path.join(dir, 'assets', 'new-hash.js'), 'console.log("new")');
    const response = await app.inject({ method: 'GET', url: '/assets/new-hash.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('javascript');
    expect(response.headers['cache-control']).toContain('immutable');
    expect(response.body).toContain('new');
    await app.close();
  });

  it('serve un index.html aggiornato dopo la registrazione', async () => {
    const { app, dir } = await fixture();
    await fs.writeFile(path.join(dir, 'index.html'), '<html><body>new</body></html>');
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('new');
    expect(response.headers['cache-control']).toBe('no-cache');
    await app.close();
  });

  it('lascia 404 gli asset mancanti', async () => {
    const { app } = await fixture();
    const response = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
