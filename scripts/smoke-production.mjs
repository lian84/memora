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

    const agents = await authFetch(`${baseUrl}/api/agents`);
    assert.equal(agents.status, 200, 'GET /api/agents deve funzionare');
    const agentsBody = await agents.json();
    assert.ok(Array.isArray(agentsBody.profiles), 'profiles deve essere un array');
    assert.ok(agentsBody.profiles.some(profile => profile.id === 'commercialista'), 'i profili di esempio devono essere disponibili');

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

    const selectedAgent = await authFetch(`${baseUrl}/api/sessions/${createdBody.sessionId}/agent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'commercialista' }),
    });
    assert.equal(selectedAgent.status, 200, 'PATCH /api/sessions/:id/agent deve funzionare');
    const selectedAgentBody = await selectedAgent.json();
    assert.deepEqual(selectedAgentBody.agent, { id: 'commercialista', name: 'Commercialista', icon: 'calculator', color: '#0f8a6a' });
    const sessionsWithAgent = await (await authFetch(`${baseUrl}/api/sessions`)).json();
    assert.equal(sessionsWithAgent.sessions.find(session => session.sessionId === createdBody.sessionId)?.agent?.id, 'commercialista');

    const clearedAgent = await authFetch(`${baseUrl}/api/sessions/${createdBody.sessionId}/agent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: null }),
    });
    assert.equal(clearedAgent.status, 200, 'PATCH profilo base deve funzionare');
    assert.equal((await clearedAgent.json()).agent, undefined);

    const reselectedAgent = await authFetch(`${baseUrl}/api/sessions/${createdBody.sessionId}/agent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'commercialista' }),
    });
    assert.equal(reselectedAgent.status, 200, 'PATCH nuovo profilo deve funzionare');
    const refreshedAgent = await authFetch(`${baseUrl}/api/sessions/${createdBody.sessionId}/agent/refresh`, { method: 'POST' });
    assert.equal(refreshedAgent.status, 200, 'POST /api/sessions/:id/agent/refresh deve funzionare');
    assert.equal((await refreshedAgent.json()).agent.id, 'commercialista');

    const createdAgent = await authFetch(`${baseUrl}/api/admin/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'smoke-agent', name: 'Smoke Agent', description: 'Smoke profile', icon: 'terminal', color: '#123456', prompt: 'Smoke prompt.' }),
    });
    assert.equal(createdAgent.status, 201, 'POST /api/admin/agents deve creare un profilo');
    assert.equal((await createdAgent.json()).profile.id, 'smoke-agent');
    const updatedAgent = await authFetch(`${baseUrl}/api/admin/agents/smoke-agent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke Agent 2' }),
    });
    assert.equal(updatedAgent.status, 200, 'PATCH /api/admin/agents/:id deve aggiornare un profilo');
    const savedSkill = await authFetch(`${baseUrl}/api/admin/agents/smoke-agent/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'checklist', description: 'Checklist smoke', content: '# Checklist' }),
    });
    assert.equal(savedSkill.status, 200, 'POST /api/admin/agents/:id/skills deve salvare una competenza');
    assert.equal((await savedSkill.json()).profile.skills[0].name, 'checklist');
    const deletedSkill = await authFetch(`${baseUrl}/api/admin/agents/smoke-agent/skills/checklist?confirm=checklist`, { method: 'DELETE' });
    assert.equal(deletedSkill.status, 200, 'DELETE skill deve spostare la competenza nel cestino');
    const deletedAgent = await authFetch(`${baseUrl}/api/admin/agents/smoke-agent?confirm=smoke-agent`, { method: 'DELETE' });
    assert.equal(deletedAgent.status, 200, 'DELETE /api/admin/agents/:id deve spostare il profilo nel cestino');

    const createdMcpAccount = await authFetch(`${baseUrl}/api/admin/mcp/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'global', serverId: 'notion', label: 'Smoke Notion', token: 'smoke-token', defaultForServer: true }),
    });
    assert.equal(createdMcpAccount.status, 201, 'POST /api/admin/mcp/accounts deve creare un account globale');
    const mcpAccountBody = await createdMcpAccount.json();
    assert.match(mcpAccountBody.account.id, /^acc_notion_/);
    const selectedMcp = await authFetch(`${baseUrl}/api/sessions/${createdBody.sessionId}/mcp`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: ['notion'], allowWrites: true }),
    });
    assert.equal(selectedMcp.status, 200, 'PATCH sessione MCP deve funzionare');
    const selectedMcpBody = await selectedMcp.json();
    assert.deepEqual(selectedMcpBody.mcp.enabled, ['notion']);
    assert.equal(selectedMcpBody.mcp.allowWrites, true);
    const mcpSession = await authFetch(`${baseUrl}/api/sessions/${createdBody.sessionId}/mcp`);
    assert.equal(mcpSession.status, 200);
    assert.deepEqual((await mcpSession.json()).mcp.enabled, ['notion']);
    await authFetch(`${baseUrl}/api/sessions/${createdBody.sessionId}/mcp`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: [] }),
    });

    const mcpAccounts = await authFetch(`${baseUrl}/api/admin/mcp/accounts`);
    assert.equal(mcpAccounts.status, 200);
    assert.ok((await mcpAccounts.json()).accounts.some(account => account.id === mcpAccountBody.account.id));
    const deletedMcpAccount = await authFetch(`${baseUrl}/api/admin/mcp/accounts/${mcpAccountBody.account.id}?confirm=${mcpAccountBody.account.id}`, { method: 'DELETE' });
    assert.equal(deletedMcpAccount.status, 200, 'DELETE account MCP deve funzionare');

    const telegramAccounts = await authFetch(`${baseUrl}/api/admin/telegram/accounts`);
    assert.equal(telegramAccounts.status, 200, 'GET /api/admin/telegram/accounts deve funzionare');
    assert.ok(Array.isArray((await telegramAccounts.json()).accounts), 'accounts deve essere un array');
    const createdTelegram = await authFetch(`${baseUrl}/api/admin/telegram/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Smoke Telegram', chatId: '424242', token: 'smoke-telegram-token' }),
    });
    assert.equal(createdTelegram.status, 201, 'POST account Telegram deve funzionare');
    const createdTelegramBody = await createdTelegram.json();
    assert.match(createdTelegramBody.account.id, /^acc_tg_/);
    assert.equal(createdTelegramBody.account.tokenConfigured, true);
    assert.doesNotMatch(JSON.stringify(createdTelegramBody), /smoke-telegram-token|botToken/i, 'il token Telegram non deve essere restituito');
    const updatedTelegram = await authFetch(`${baseUrl}/api/admin/telegram/accounts/${createdTelegramBody.account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Smoke Telegram 2', chatId: '424243' }),
    });
    assert.equal(updatedTelegram.status, 200, 'PATCH account Telegram deve funzionare');
    assert.equal((await updatedTelegram.json()).account.label, 'Smoke Telegram 2');
    const deletedTelegram = await authFetch(`${baseUrl}/api/admin/telegram/accounts/${createdTelegramBody.account.id}?confirm=${createdTelegramBody.account.id}`, { method: 'DELETE' });
    assert.equal(deletedTelegram.status, 200, 'DELETE account Telegram deve funzionare');

    const automationsBefore = await authFetch(`${baseUrl}/api/admin/automations`);
    assert.equal(automationsBefore.status, 200, 'GET /api/admin/automations deve funzionare');
    assert.ok(Array.isArray((await automationsBefore.json()).jobs), 'jobs deve essere un array');
    const createdAutomation = await authFetch(`${baseUrl}/api/admin/automations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke automation', prompt: 'Smoke prompt', cron: '0 9 * * *', timezone: 'Europe/Rome', enabled: false, notifyTelegram: false }),
    });
    assert.equal(createdAutomation.status, 201, 'POST /api/admin/automations deve creare un job');
    const createdAutomationBody = await createdAutomation.json();
    assert.match(createdAutomationBody.job.id, /^job_/);
    assert.equal(createdAutomationBody.job.enabled, false);
    const enabledAutomation = await authFetch(`${baseUrl}/api/admin/automations/${createdAutomationBody.job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(enabledAutomation.status, 200, 'PATCH /api/admin/automations/:id deve aggiornare un job');
    assert.equal((await enabledAutomation.json()).job.enabled, true);
    const automationRuns = await authFetch(`${baseUrl}/api/admin/automations/${createdAutomationBody.job.id}/runs`);
    assert.equal(automationRuns.status, 200, 'GET cronologia automazione deve funzionare');
    assert.deepEqual((await automationRuns.json()).runs, []);
    const deletedAutomation = await authFetch(`${baseUrl}/api/admin/automations/${createdAutomationBody.job.id}?confirm=${createdAutomationBody.job.id}`, { method: 'DELETE' });
    assert.equal(deletedAutomation.status, 200, 'DELETE /api/admin/automations/:id deve funzionare');

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
    console.log(`- Telegram accounts + automations CRUD: ok`);
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
