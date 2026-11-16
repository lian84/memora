import { memoraEnv } from './env.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(repoRoot, 'apps', 'server', 'dist', 'index.js');
const webIndex = path.join(repoRoot, 'apps', 'dist', 'web', 'index.html');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, child, logs) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Server terminato prima dello smoke test (exit ${child.exitCode}).\n${logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server non ancora in ascolto.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server non pronto dopo 10 secondi.\n${logs()}`);
}

async function shutdown(child) {
  if (child.exitCode !== null) return child.exitCode;
  const exit = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  child.kill('SIGTERM');
  const result = await Promise.race([
    exit,
    new Promise((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]);
  if (!result) {
    child.kill('SIGKILL');
    throw new Error('Graceful shutdown non completato entro 10 secondi');
  }
  return result.code;
}

async function main() {
  for (const file of [serverEntry, webIndex]) {
    try {
      await fs.access(file);
    } catch {
      throw new Error(`File production mancante: ${file}. Esegui pnpm build.`);
    }
  }

  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-prod-smoke-'));
  let output = '';
  const child = spawn(process.execPath, [serverEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MEMORA_HOST: '127.0.0.1',
      MEMORA_PORT: String(port),
      MEMORA_DATA_DIR: dataDir,
      MEMORA_CWD: repoRoot,
      MEMORA_MEMORY_WRITER_ENABLED: 'false',
      OPENROUTER_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, child, () => output);

    const root = await fetch(`${baseUrl}/`);
    assert.equal(root.status, 200, 'GET / deve rispondere 200');
    assert.match(root.headers.get('content-type') ?? '', /text\/html/, 'GET / deve essere HTML');
    const rootHtml = await root.text();
    assert.match(rootHtml, /id="root"/, 'GET / deve restituire la shell React');

    const queryRoot = await fetch(`${baseUrl}/?session=smoke-test`);
    assert.equal(queryRoot.status, 200, 'GET /?session=... deve rispondere 200');
    assert.match(await queryRoot.text(), /id="root"/, 'la query string non deve rompere la SPA');

    const spaRoute = await fetch(`${baseUrl}/future/chat/route?session=smoke-test`);
    assert.equal(spaRoute.status, 200, 'una route SPA deve ricevere index.html');
    assert.match(spaRoute.headers.get('content-type') ?? '', /text\/html/, 'la route SPA deve essere HTML');
    assert.match(await spaRoute.text(), /id="root"/, 'la route SPA deve restituire la shell React');

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', service: 'memora' });

    const setup = await fetch(`${baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'smoke-test-password-123' }),
    });
    assert.equal(setup.status, 201, 'il primo setup deve impostare la password');
    const cookie = String(setup.headers.get('set-cookie')).split(';')[0];
    assert.match(cookie, /^memora_session=/, 'il setup deve restituire il cookie di sessione');
    const authFetch = (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), cookie } });

    const sessions = await authFetch(`${baseUrl}/api/sessions`);
    assert.equal(sessions.status, 200, 'GET /api/sessions deve funzionare');
    assert.ok(Array.isArray((await sessions.json()).sessions), 'sessions deve essere un array');

    const projects = await authFetch(`${baseUrl}/api/projects`);
    assert.equal(projects.status, 200, 'GET /api/projects deve funzionare');
    assert.ok(Array.isArray((await projects.json()).projects), 'projects deve essere un array');

    const sources = await authFetch(`${baseUrl}/api/memory/sources`);
    assert.equal(sources.status, 200, 'GET /api/memory/sources deve funzionare');
    assert.ok(Array.isArray((await sources.json()).sources), 'sources deve essere un array');

    const adminSettings = await authFetch(`${baseUrl}/api/admin/settings`);
    assert.equal(adminSettings.status, 200, 'GET /api/admin/settings deve funzionare');
    const adminSettingsBody = await adminSettings.json();
    assert.equal(adminSettingsBody.settings.memory.searchMode.source, 'default');
    assert.doesNotMatch(JSON.stringify(adminSettingsBody), /apiKey|"secret"|bearer|sk-[A-Za-z0-9]{8,}/i);

    const secrets = await authFetch(`${baseUrl}/api/admin/secrets`);
    assert.equal(secrets.status, 200, 'GET /api/admin/secrets deve funzionare');
    const secretsBody = await secrets.json();
    assert.equal(secretsBody.openrouter.configured, false);
    assert.equal(secretsBody['opencode-go'].source, 'none');

    const chatPatch = await authFetch(`${baseUrl}/api/admin/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: { provider: 'opencode-go', defaultModel: 'deepseek-v4.1-flash' } }),
    });
    assert.equal(chatPatch.status, 200, 'PATCH chat OpenCode Go deve validare il modello');
    const chatPatchBody = await chatPatch.json();
    assert.deepEqual(chatPatchBody.appliedLive, ['chat.provider', 'chat.defaultModel']);
    const createdWithNewDefault = await authFetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(createdWithNewDefault.status, 201);
    const createdBody = await createdWithNewDefault.json();
    assert.equal(createdBody.provider, 'opencode-go');
    assert.equal(createdBody.modelId, 'deepseek-v4.1-flash');

    const adminStatus = await authFetch(`${baseUrl}/api/admin/status`);
    assert.equal(adminStatus.status, 200, 'GET /api/admin/status deve funzionare');
    const adminStatusBody = await adminStatus.json();
    assert.equal(adminStatusBody.memory.effectiveMode, 'lexical');
    assert.equal(typeof adminStatusBody.secondBrain.sourceCount, 'number');

    const adminPatch = await authFetch(`${baseUrl}/api/admin/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memory: { topK: 6 } }),
    });
    assert.equal(adminPatch.status, 200, 'PATCH /api/admin/settings deve applicare topK');
    const adminPatchBody = await adminPatch.json();
    assert.deepEqual(adminPatchBody.changed, ['memory.topK']);
    assert.deepEqual(adminPatchBody.appliedLive, ['memory.topK']);
    const adminStatusAfter = await (await authFetch(`${baseUrl}/api/admin/status`)).json();
    assert.equal(adminStatusAfter.memory.topK, 6, 'topK deve essere applicato live');

    const missingApi = await authFetch(`${baseUrl}/api/route-inesistente`);
    assert.equal(missingApi.status, 404, 'le API sconosciute devono restare 404');
    assert.match(missingApi.headers.get('content-type') ?? '', /application\/json/, 'API 404 deve essere JSON');
    assert.doesNotMatch(await missingApi.text(), /id="root"/, 'il fallback SPA non deve coprire /api/*');

    const missingAsset = await fetch(`${baseUrl}/assets/file-inesistente.js`);
    assert.equal(missingAsset.status, 404, 'un asset mancante non deve diventare index.html');
    assert.match(missingAsset.headers.get('content-type') ?? '', /application\/json/, 'asset 404 deve essere JSON');

    const exitCode = await shutdown(child);
    assert.equal(exitCode, 0, 'SIGTERM deve terminare il server con exit code 0');

    console.log('PRODUCTION SMOKE OK');
    console.log(`- frontend: ${webIndex}`);
    console.log(`- GET /, /?session=..., /future/chat/route: HTML React`);
    console.log(`- GET /api/health: ok`);
    console.log(`- GET /api/sessions: ok`);
    console.log(`- GET /api/memory/sources: ok`);
    console.log(`- Admin settings/status + live PATCH: ok`);
    console.log(`- Admin secrets + OpenCode Go chat default: ok`);
    console.log(`- API/asset mancanti: 404 senza fallback SPA`);
    console.log(`- SIGTERM: graceful shutdown`);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('PRODUCTION SMOKE FAILED');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
