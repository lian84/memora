import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { AgentService, PERSONAL_ASSISTANT_SYSTEM_PROMPT } from './index';
import type { AgentServiceConfig } from '@memora/shared';

const roots: string[] = [];

async function createIsolationFixture(): Promise<{ root: string; legacyCwd: string; config: AgentServiceConfig }> {
  const root = await mkdtemp(join(tmpdir(), 'memora-assistant-isolation-'));
  const legacyCwd = await mkdtemp(join(tmpdir(), 'memora-repo-cwd-'));
  roots.push(root, legacyCwd);

  await mkdir(join(root, 'runtime', 'assistant'), { recursive: true });
  await mkdir(join(root, '.pi', 'skills'), { recursive: true });
  await mkdir(join(root, '.pi', 'prompts'), { recursive: true });
  await mkdir(join(root, '.pi', 'extensions'), { recursive: true });
  await writeFile(join(legacyCwd, 'AGENTS.md'), '# Repository context\n\nContamination.\n');
  await writeFile(join(root, 'runtime', 'assistant', 'AGENTS.md'), '# Runtime context\n\nContamination.\n');
  await writeFile(join(root, '.pi', 'skills', 'contaminating.md'), '# Contaminating skill\n');
  await writeFile(join(root, '.pi', 'prompts', 'contaminating.md'), '# Contaminating prompt\n');
  await writeFile(join(root, '.pi', 'extensions', 'contaminating.ts'), 'export default function () {}\n');

  return {
    root,
    legacyCwd,
    config: {
      dataDir: root,
      cwd: legacyCwd,
      openRouterApiKey: '',
      openRouterModel: 'openrouter/auto',
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Personal Assistant runtime isolation', () => {
  it('crea sessioni senza built-in tool, context files, skills o prompt del repository', async () => {
    const { root, config } = await createIsolationFixture();
    const service = new AgentService(config);

    const created = await service.createSession('openrouter/auto');
    const diagnostics = service.getSessionRuntimeDiagnostics(created.sessionId);

    expect(diagnostics.cwd).toBe(join(root, 'runtime', 'assistant'));
    expect(diagnostics.activeTools).toEqual(['create_artifact', 'create_pdf', 'create_docx', 'create_xlsx', 'create_pptx']);
    for (const tool of ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']) {
      expect(diagnostics.activeTools).not.toContain(tool);
    }
    expect(diagnostics.contextFiles).toEqual([]);
    expect(diagnostics.skills).toEqual([]);
    expect(diagnostics.prompts).toEqual([]);
    expect(diagnostics.extensions).toContain('<inline:1>');
    expect(diagnostics.systemPrompt).toContain('Sei Memo');
    expect(diagnostics.systemPrompt).toContain('NON sono conoscenza');
    expect(diagnostics.systemPrompt).toBe(PERSONAL_ASSISTANT_SYSTEM_PROMPT);

    service.disposeAll();
  });

  it('applica la stessa policy a una sessione ripresa', async () => {
    const { root, config } = await createIsolationFixture();
    const assistantCwd = join(root, 'runtime', 'assistant');
    const sessionId = 'resume-assistant-isolation';
    const sessionDir = join(root, 'pi-sessions');
    const manager = SessionManager.create(assistantCwd, sessionDir, { id: sessionId });
    manager.appendMessage({ role: 'user', content: 'Ciao', timestamp: Date.now() } as Parameters<typeof manager.appendMessage>[0]);

    const service = new AgentService(config);
    const resumed = await service.resumeSession(sessionId);
    const diagnostics = service.getSessionRuntimeDiagnostics(resumed.sessionId);

    expect(diagnostics.cwd).toBe(assistantCwd);
    expect(diagnostics.activeTools).toEqual(['create_artifact', 'create_pdf', 'create_docx', 'create_xlsx', 'create_pptx']);
    expect(diagnostics.contextFiles).toEqual([]);
    expect(diagnostics.skills).toEqual([]);
    expect(diagnostics.prompts).toEqual([]);
    expect(diagnostics.extensions).toContain('<inline:1>');

    service.disposeAll();
  });

  it('noTools builtin lascia disponibili le custom/integration tools esplicitamente registrate', async () => {
    const { root } = await createIsolationFixture();
    const assistantCwd = join(root, 'runtime', 'assistant');
    const agentDir = join(root, '.pi');
    const loader = new DefaultResourceLoader({
      cwd: assistantCwd,
      agentDir,
      settingsManager: SettingsManager.create(assistantCwd, agentDir),
      noContextFiles: true,
      noSkills: true,
      noPromptTemplates: true,
      noExtensions: true,
      extensionFactories: [
        (pi) => {
          pi.registerTool({
            name: 'pi_hub_test_tool',
            label: 'Memora test tool',
            description: 'Test custom tool',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }),
          } as unknown as ToolDefinition);
        },
      ],
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: assistantCwd,
      agentDir,
      sessionManager: SessionManager.inMemory(assistantCwd),
      resourceLoader: loader,
      noTools: 'builtin',
    });

    const activeTools = session.getActiveToolNames();
    expect(activeTools).toContain('pi_hub_test_tool');
    for (const tool of ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']) {
      expect(activeTools).not.toContain(tool);
    }
    session.dispose();
  });
});
