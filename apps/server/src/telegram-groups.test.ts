import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramGroupError, TelegramGroupStore } from './telegram-groups.js';

const ACCOUNT = 'acc_tg_test';
const GROUP = '-1001234567890';
const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-groups-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function storeAt(dataDir: string, options: { now?: () => number } = {}): Promise<TelegramGroupStore> {
  const store = new TelegramGroupStore({ dataDir, ...options });
  await store.load();
  return store;
}

describe('TelegramGroupStore', () => {
  it('salva un gruppo, la sessione General e i topic con permessi 0600', async () => {
    const dataDir = await tempDir();
    const store = await storeAt(dataDir);
    const group = await store.upsert(ACCOUNT, {
      chatId: GROUP,
      title: 'Memora Lavoro',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
      defaultAgentProfileId: 'sviluppatore',
    });
    expect(group).toMatchObject({ chatId: GROUP, title: 'Memora Lavoro', isForum: true, allowedUsers: ['42'], defaultProjectId: 'lavoro', showProjectInTopicTitle: false });

    await store.setGeneralSession(ACCOUNT, GROUP, 'sess_general');
    await store.putTopic(ACCOUNT, GROUP, { threadId: '17', sessionId: 'sess_topic', title: 'Preventivo', projectId: 'lavoro', agentProfileId: 'sviluppatore' });
    expect(store.getTopic(ACCOUNT, GROUP, '17')).toMatchObject({ sessionId: 'sess_topic', projectId: 'lavoro', agentProfileId: 'sviluppatore', title: 'Preventivo', titleSource: 'manual' });
    expect((await fs.stat(store.filePath)).mode & 0o777).toBe(0o600);

    const reloaded = await storeAt(dataDir);
    expect(reloaded.get(ACCOUNT, GROUP)).toMatchObject({ generalSessionId: 'sess_general' });
    expect(reloaded.getTopic(ACCOUNT, GROUP, '17')).toMatchObject({ sessionId: 'sess_topic', projectId: 'lavoro', agentProfileId: 'sviluppatore' });
  });

  it('aggiorna lo stato del turno e trova il topic per sessione', async () => {
    const store = await storeAt(await tempDir());
    await store.upsert(ACCOUNT, { chatId: GROUP, title: 'Gruppo', isForum: true, allowedUsers: ['42'] });
    await store.putTopic(ACCOUNT, GROUP, { threadId: '17', sessionId: 'sess_topic', title: 'Chat' });
    await store.updateTopicTurn(ACCOUNT, GROUP, '17', { lastTurnId: 'turn-1', pendingTurnId: 'turn-1' });
    expect(store.getTopic(ACCOUNT, GROUP, '17')).toMatchObject({ lastTurnId: 'turn-1', pendingTurnId: 'turn-1' });
    expect(store.findTopicBySession(ACCOUNT, 'sess_topic')).toMatchObject({ chatId: GROUP, topic: { threadId: '17' } });
    await store.setGeneralSession(ACCOUNT, GROUP, 'sess_general');
    await store.updateGeneralTurn(ACCOUNT, GROUP, { lastTurnId: 'turn-g', pendingTurnId: 'turn-g' });
    expect(store.get(ACCOUNT, GROUP)).toMatchObject({ generalLastTurnId: 'turn-g', generalPendingTurnId: 'turn-g' });
    await store.updateGeneralTurn(ACCOUNT, GROUP, { pendingTurnId: null });
    expect(store.get(ACCOUNT, GROUP)?.generalPendingTurnId).toBeUndefined();
    await store.updateTopicTitle(ACCOUNT, GROUP, '17', 'Titolo aggiornato');
    expect(store.getTopic(ACCOUNT, GROUP, '17')).toMatchObject({ title: 'Titolo aggiornato', titleSource: 'manual' });
    await store.updateTopicState(ACCOUNT, GROUP, '17', 'closed');
    expect(store.getTopic(ACCOUNT, GROUP, '17')?.state).toBe('closed');
    await store.updateTopicState(ACCOUNT, GROUP, '17', 'deleted');
    expect(store.getTopic(ACCOUNT, GROUP, '17')?.state).toBe('deleted');
    await expect(store.updateTopicState(ACCOUNT, GROUP, '17', 'boh' as never)).rejects.toMatchObject({ code: 'invalid_telegram_topic_state' });
    await store.updateTopicTitle(ACCOUNT, GROUP, '17', 'Titolo aggiornato');
    expect(store.getTopic(ACCOUNT, GROUP, '17')).toMatchObject({ title: 'Titolo aggiornato', titleSource: 'manual' });
    await store.updateTopicTurn(ACCOUNT, GROUP, '17', { pendingTurnId: null });
    expect(store.getTopic(ACCOUNT, GROUP, '17')?.pendingTurnId).toBeUndefined();
    expect(await store.removeTopic(ACCOUNT, GROUP, '17')).toBe(true);
    expect(store.findTopicBySession(ACCOUNT, 'sess_topic')).toBeUndefined();
    await store.putTopic(ACCOUNT, GROUP, { threadId: '18', sessionId: 'sess_delete', title: 'Delete' });
    expect(await store.removeTopicsForSession('sess_delete')).toBe(1);
    expect(store.getTopic(ACCOUNT, GROUP, '18')).toBeUndefined();
  });

  it('aggiorna progetto, profilo e prefisso del gruppo', async () => {
    const store = await storeAt(await tempDir());
    await store.upsert(ACCOUNT, { chatId: GROUP, title: 'Gruppo', isForum: true, allowedUsers: ['42'] });
    const updated = await store.updateSettings(ACCOUNT, GROUP, {
      defaultProjectId: 'lavoro',
      defaultAgentProfileId: 'sviluppatore',
      showProjectInTopicTitle: true,
    });
    expect(updated).toMatchObject({
      defaultProjectId: 'lavoro',
      defaultAgentProfileId: 'sviluppatore',
      showProjectInTopicTitle: true,
    });
    const cleared = await store.updateSettings(ACCOUNT, GROUP, { defaultProjectId: null, showProjectInTopicTitle: false });
    expect(cleared.defaultProjectId).toBeNull();
    expect(cleared.showProjectInTopicTitle).toBe(false);
    await expect(store.updateSettings(ACCOUNT, GROUP, { defaultProjectId: 'Non Valido' })).rejects.toMatchObject({ code: 'invalid_telegram_project_id' });
  });

  it('aggiorna le impostazioni del gruppo senza perdere i topic', async () => {
    const store = await storeAt(await tempDir());
    await store.upsert(ACCOUNT, { chatId: GROUP, title: 'Prima', isForum: true, allowedUsers: ['42'] });
    await store.putTopic(ACCOUNT, GROUP, { threadId: '17', sessionId: 'sess_topic', title: 'Chat' });
    await store.upsert(ACCOUNT, { chatId: GROUP, title: 'Seconda', isForum: true, allowedUsers: ['42', '43'], defaultProjectId: 'casa' });
    expect(store.get(ACCOUNT, GROUP)).toMatchObject({ title: 'Seconda', allowedUsers: ['42', '43'], defaultProjectId: 'casa' });
    expect(store.getTopic(ACCOUNT, GROUP, '17')).toBeDefined();
  });

  it('valida chat, thread, utenti e titoli', async () => {
    const store = await storeAt(await tempDir());
    await expect(store.upsert(ACCOUNT, { chatId: '123', title: 'Gruppo', isForum: true, allowedUsers: ['42'] })).rejects.toMatchObject({ code: 'invalid_telegram_group_chat' });
    await expect(store.upsert(ACCOUNT, { chatId: GROUP, title: 'Gruppo', isForum: true, allowedUsers: [] })).rejects.toMatchObject({ code: 'invalid_telegram_group_users' });
    await store.upsert(ACCOUNT, { chatId: GROUP, title: 'Gruppo', isForum: true, allowedUsers: ['42'] });
    await expect(store.putTopic(ACCOUNT, GROUP, { threadId: '0', sessionId: 'sess_topic', title: 'Chat' })).rejects.toBeInstanceOf(TelegramGroupError);
    await expect(store.putTopic(ACCOUNT, GROUP, { threadId: '17', sessionId: '../bad', title: 'Chat' })).rejects.toMatchObject({ code: 'invalid_telegram_group_session' });
  });

  it('rimuove gruppi e account senza toccare le sessioni', async () => {
    const store = await storeAt(await tempDir());
    await store.upsert(ACCOUNT, { chatId: GROUP, title: 'Gruppo', isForum: true, allowedUsers: ['42'] });
    expect(await store.removeGroup(ACCOUNT, GROUP)).toBe(true);
    expect(store.get(ACCOUNT, GROUP)).toBeUndefined();
    await store.upsert(ACCOUNT, { chatId: GROUP, title: 'Gruppo', isForum: true, allowedUsers: ['42'] });
    expect(await store.removeAccount(ACCOUNT)).toBe(1);
    expect(store.list(ACCOUNT)).toEqual([]);
  });

  it('ignora un file corrotto e un topic non valido', async () => {
    const dataDir = await tempDir();
    await fs.mkdir(path.join(dataDir, 'config'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'config', 'telegram-groups.json'), '{bad');
    const warn = vi.fn();
    const store = new TelegramGroupStore({ dataDir, warn });
    await store.load();
    expect(warn).toHaveBeenCalled();
    expect(store.list(ACCOUNT)).toEqual([]);
  });
});
