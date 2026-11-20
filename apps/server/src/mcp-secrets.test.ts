import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpSecretStore } from './mcp-secrets.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

test('salva i token MCP separatamente e non li espone nella lista', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memora-mcp-secrets-'));
  roots.push(root);
  const store = new McpSecretStore(root);
  await store.set('acc_notion_work', 'ntn_segreto');
  expect(await store.get('acc_notion_work')).toBe('ntn_segreto');
  expect(await store.has('acc_notion_work')).toBe(true);
  const raw = await readFile(join(root, 'config', 'mcp-secrets.json'), 'utf8');
  expect(raw).toContain('ntn_segreto');
  await store.delete('acc_notion_work');
  expect(await store.has('acc_notion_work')).toBe(false);
});
