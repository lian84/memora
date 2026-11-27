import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { splitTelegramText, TelegramError, TelegramService, TelegramStore } from './telegram.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('TelegramStore', () => {
  it('salva più account separatamente dai token', async () => {
    const dataDir = await tempDir();
    const store = new TelegramStore({ dataDir });
    await store.load();
    const first = await store.createAccount({ label: 'Personale', chatId: '42', token: '123456:abcdefghijklmnopqrstuvwxyz' });
    const second = await store.createAccount({ label: 'Lavoro', chatId: '-100123', token: '654321:zyxwvutsrqponmlkjihgfedcba' });
    expect(first.id).toMatch(/^acc_tg_/);
    expect(second.id).not.toBe(first.id);
    expect(store.listAccounts()).toHaveLength(2);
    expect(store.listAccounts()[0]).toMatchObject({ label: 'Personale', tokenConfigured: true, tokenSource: 'secret' });
    const accountsRaw = await fs.readFile(path.join(dataDir, 'config', 'telegram-accounts.json'), 'utf8');
    expect(accountsRaw).not.toContain('abcdefghijklmnopqrstuvwxyz');
    const secretsRaw = await fs.readFile(path.join(dataDir, 'config', 'telegram-secrets.json'), 'utf8');
    expect(secretsRaw).toContain(first.id);
    const mode = (await fs.stat(path.join(dataDir, 'config', 'telegram-secrets.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('aggiorna ed elimina un account senza toccare gli altri', async () => {
    const dataDir = await tempDir();
    const store = new TelegramStore({ dataDir });
    await store.load();
    const first = await store.createAccount({ label: 'A', chatId: '1', token: 'a-token' });
    const second = await store.createAccount({ label: 'B', chatId: '2', token: 'b-token' });
    await store.updateAccount(first.id, { label: 'A2', chatId: '3', enabled: false });
    expect(store.getAccount(first.id)).toMatchObject({ label: 'A2', chatId: '3', enabled: false, tokenConfigured: true });
    await store.deleteAccount(first.id);
    expect(store.getAccount(first.id)).toBeUndefined();
    expect(store.getAccount(second.id)).toBeDefined();
  });

  it('rifiuta chat ID non numerici', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    await expect(store.createAccount({ label: 'A', chatId: '@canale', token: 'token' })).rejects.toBeInstanceOf(TelegramError);
  });

  it('usa il token environment per l’account predefinito', async () => {
    const store = new TelegramStore({ dataDir: await tempDir(), env: { MEMORA_TELEGRAM_BOT_TOKEN: '123:env' } });
    await store.load();
    expect(store.listAccounts()[0]).toMatchObject({ id: 'acc_tg_default', tokenConfigured: true, tokenSource: 'environment' });
    expect(store.getToken('acc_tg_default')).toBe('123:env');
  });

  it('migra la vecchia configurazione a token singolo', async () => {
    const dataDir = await tempDir();
    await fs.mkdir(path.join(dataDir, 'config'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'config', 'telegram.json'), JSON.stringify({ version: 1, enabled: true, chatId: '42' }));
    await fs.writeFile(path.join(dataDir, 'config', 'telegram-secrets.json'), JSON.stringify({ version: 1, botToken: 'old-token' }));
    const store = new TelegramStore({ dataDir });
    await store.load();
    expect(store.listAccounts()[0]).toMatchObject({ id: 'acc_tg_default', enabled: true, chatId: '42', tokenConfigured: true });
    expect((await fs.stat(path.join(dataDir, 'config', 'telegram-accounts.json'))).mode & 0o777).toBe(0o600);
  });
});

describe('TelegramService', () => {
  it('invia messaggi spezzati usando l’account richiesto', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }); });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.send('x'.repeat(9_000), account.id)).resolves.toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(firstUrl).toContain('/bot123:token/sendMessage');
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.chat_id).toBe('42');
    expect(body.text).toHaveLength(4_000);
  });

  it('invia un documento con multipart', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }); });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await service.sendDocument({ filename: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') }, account.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/bot123:token/sendDocument');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBeInstanceOf(FormData);
  });

  it('scopre le chat dagli update e ignora duplicati', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '', token: '123:token' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: [
      { message: { chat: { id: 42, type: 'private', first_name: 'Memo' } } },
      { message: { chat: { id: 42, type: 'private', first_name: 'Memo' } } },
      { channel_post: { chat: { id: -100, type: 'channel', title: 'Note' } } },
    ] }), { status: 200 }));
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.discoverChats(account.id)).resolves.toEqual([
      { id: '42', label: 'Memo', type: 'private' },
      { id: '-100', label: 'Note', type: 'channel' },
    ]);
  });

  it('propaga gli errori API senza esporre il token', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:secret-token' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 }));
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.send('test', account.id)).rejects.toMatchObject({ code: 'telegram_api_error' });
  });

  it('invia a una chat esplicita con HTML senza usare la chat di notifica', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '99', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }); });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await service.sendTo('42', '<b>Ciao</b>', account.id, { parseMode: 'HTML' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/sendMessage');
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({ chat_id: '42', text: '<b>Ciao</b>', parse_mode: 'HTML', disable_web_page_preview: true });
  });

  it('modifica un messaggio e ignora “message is not modified”', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }); });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await service.editMessage('42', 7, '<b>Aggiornato</b>', account.id, { parseMode: 'HTML' });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/editMessageText');
    expect(body).toMatchObject({ chat_id: '42', message_id: 7, parse_mode: 'HTML' });

    const notModified = vi.fn(async () => new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' }), { status: 400 }));
    const tolerant = new TelegramService(store, notModified as unknown as typeof fetch);
    await expect(tolerant.editMessage('42', 7, 'stesso testo', account.id)).resolves.toBeUndefined();
  });

  it('invia il typing e legge i metadati di un file', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const method = String(args[0]);
      if (method.includes('/getFile')) {
        return new Response(JSON.stringify({ ok: true, result: { file_id: 'file-1', file_path: 'photos/a.jpg', file_size: 123 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await service.sendChatAction('42', 'typing', account.id);
    await expect(service.getFile('file-1', account.id)).resolves.toEqual({ fileId: 'file-1', filePath: 'photos/a.jpg', size: 123 });
    const actionBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(actionBody).toEqual({ chat_id: '42', action: 'typing' });
  });

  it('rifiuta un file senza percorso e un’azione non valida', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { file_id: 'x' } }), { status: 200 }));
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.getFile('file-1', account.id)).rejects.toMatchObject({ code: 'telegram_file_unavailable' });
    await expect(service.sendChatAction('42', 'boh' as never, account.id)).rejects.toMatchObject({ code: 'invalid_telegram_action' });
  });

  it('legge il bot e registra i comandi', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).includes('/getMe')) {
        return new Response(JSON.stringify({ ok: true, result: { id: 123, is_bot: true, first_name: 'Memora', username: 'memora_bot', can_read_all_group_messages: true } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.getMe(account.id)).resolves.toEqual({ id: '123', firstName: 'Memora', username: 'memora_bot', canReadAllGroupMessages: true });
    await service.setMyCommands([{ command: 'start', description: 'Avvia Memora' }], account.id, { languageCode: 'it' });
    const body = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/setMyCommands');
    expect(body).toEqual({ commands: [{ command: 'start', description: 'Avvia Memora' }], language_code: 'it' });
  });

  it('invia lo scope dei comandi per i gruppi', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }); });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await service.setMyCommands([{ command: 'help', description: 'Aiuto' }], account.id, {
      scope: { type: 'all_group_chats' },
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.scope).toEqual({ type: 'all_group_chats' });
  });

  it('valida i comandi prima di chiamare Telegram', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }));
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.setMyCommands([{ command: 'Start', description: 'Maiuscolo' }], account.id)).rejects.toMatchObject({ code: 'invalid_telegram_commands' });
    await expect(service.setMyCommands([{ command: 'start', description: 'x' }, { command: 'start', description: 'y' }], account.id)).rejects.toMatchObject({ code: 'invalid_telegram_commands' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ritenta un 429 rispettando retry_after e poi lo propaga', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const limited = () => new Response(JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 2 } }), { status: 429 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }));
    const sleep = vi.fn(async (milliseconds: number) => { void milliseconds; });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch, { sleep, maxRetries: 1 });
    await service.sendTo('42', 'ciao', account.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);

    const alwaysLimited = vi.fn(async () => limited());
    const exhaustedSleep = vi.fn(async (milliseconds: number) => { void milliseconds; });
    const exhausted = new TelegramService(store, alwaysLimited as unknown as typeof fetch, { sleep: exhaustedSleep, maxRetries: 1 });
    await expect(exhausted.sendTo('42', 'ciao', account.id)).rejects.toMatchObject({ code: 'telegram_rate_limited', retryAfterMs: 2_000 });
    expect(alwaysLimited).toHaveBeenCalledTimes(2);
    expect(exhaustedSleep).toHaveBeenCalledWith(2_000);
  });

  it('invia un documento a una chat esplicita', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '99', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }); });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await service.sendDocumentTo('42', { filename: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') }, account.id);
    const form = (fetchMock.mock.calls[0]?.[1] as RequestInit).body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('chat_id')).toBe('42');
    expect((form.get('document') as { name?: string } | null)?.name).toBe('report.pdf');
  });

  it('rifiuta una chat non numerica prima della richiesta', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }));
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.sendTo('@canale', 'ciao', account.id)).rejects.toMatchObject({ code: 'invalid_telegram_chat_id' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('esegue getUpdates con offset e timeout espliciti', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }); });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.getUpdates(account.id, { offset: 42, timeoutSeconds: 5, limit: 10, allowedUpdates: ['message'] })).resolves.toEqual([]);
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/getUpdates');
    expect(body).toEqual({ offset: 42, timeout: 5, limit: 10, allowed_updates: ['message'] });

    await service.getUpdates(account.id, { timeoutSeconds: 0 });
    const noOffset = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(noOffset.offset).toBeUndefined();
  });

  it('non ritenta automaticamente i 429 di getUpdates', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '', token: '123:token' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 1 } }), { status: 429 }));
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.getUpdates(account.id, { timeoutSeconds: 0 })).rejects.toMatchObject({ code: 'telegram_rate_limited', retryAfterMs: 1_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('scarica un file Telegram con limite e percorso validato', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      if (url.includes('/file/bot')) {
        return new Response(Buffer.from('contenuto'), { status: 200, headers: { 'content-length': '10' } });
      }
      return new Response(JSON.stringify({ ok: false, description: 'not found' }), { status: 404 });
    });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.downloadFile('photos/a.jpg', account.id, 100)).resolves.toEqual(Buffer.from('contenuto'));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/file/bot123:token/photos/a.jpg');
    await expect(service.downloadFile('photos/a.jpg', account.id, 5)).rejects.toMatchObject({ code: 'telegram_file_too_large' });
    await expect(service.downloadFile('../secret', account.id)).rejects.toMatchObject({ code: 'invalid_telegram_file_path' });

    const failing = new TelegramService(store, vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'file not found' }), { status: 404 })) as unknown as typeof fetch);
    await expect(failing.downloadFile('photos/a.jpg', account.id)).rejects.toMatchObject({ code: 'telegram_file_download_failed' });
  });

  it('invia messaggi, typing e documenti in un topic', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }); });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await service.sendTo('42', 'ciao', account.id, { messageThreadId: 17 });
    await service.sendChatAction('42', 'typing', account.id, { messageThreadId: 17 });
    await service.sendDocumentTo('42', { filename: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') }, account.id, { messageThreadId: 17 });
    const messageBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(messageBody.message_thread_id).toBe(17);
    const actionBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(actionBody.message_thread_id).toBe(17);
    const form = (fetchMock.mock.calls[2]?.[1] as RequestInit).body as FormData;
    expect(form.get('message_thread_id')).toBe('17');
  });

  it('modifica un messaggio dentro un topic', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }); });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await service.editMessage('42', 7, 'aggiornato', account.id, { parseMode: 'HTML', messageThreadId: 17 });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({ chat_id: '42', message_id: 7, message_thread_id: 17, parse_mode: 'HTML' });
  });

  it('gestisce i topic forum e le informazioni del gruppo', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      if (url.includes('/createForumTopic')) {
        return new Response(JSON.stringify({ ok: true, result: { message_thread_id: 17, name: 'Preventivo' } }), { status: 200 });
      }
      if (url.includes('/getChatMember')) {
        return new Response(JSON.stringify({ ok: true, result: { status: 'administrator', can_manage_topics: true } }), { status: 200 });
      }
      if (url.includes('/getChat')) {
        return new Response(JSON.stringify({ ok: true, result: { id: -100123, type: 'supergroup', title: 'Memora', is_forum: true } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.createForumTopic('-100123', 'Preventivo', account.id)).resolves.toEqual({ threadId: '17', name: 'Preventivo' });
    await service.editForumTopic('-100123', 17, 'Preventivo 2', account.id);
    await service.closeForumTopic('-100123', 17, account.id);
    await expect(service.getChat('-100123', account.id)).resolves.toEqual({ id: '-100123', type: 'supergroup', title: 'Memora', isForum: true });
    await expect(service.getChatMember('-100123', 42, account.id)).resolves.toEqual({ status: 'administrator', canManageTopics: true });
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({ chat_id: '-100123', name: 'Preventivo' });
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({ chat_id: '-100123', message_thread_id: 17, name: 'Preventivo 2' });
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toMatchObject({ chat_id: '-100123', message_thread_id: 17 });
    expect(JSON.parse(String((fetchMock.mock.calls[4]?.[1] as RequestInit).body))).toMatchObject({ chat_id: '-100123', user_id: '42' });
  });

  it('legge e applica le icone dei topic', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      if (url.includes('/getForumTopicIconStickers')) {
        return new Response(JSON.stringify({ ok: true, result: [{ custom_emoji_id: '123456', emoji: '✅' }] }), { status: 200 });
      }
      if (url.includes('/createForumTopic')) {
        return new Response(JSON.stringify({ ok: true, result: { message_thread_id: 17, name: 'Preventivo' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.getForumTopicIconStickers(account.id)).resolves.toEqual([{ customEmojiId: '123456', emoji: '✅' }]);
    await service.createForumTopic('-100123', 'Preventivo', account.id, { iconCustomEmojiId: '123456' });
    await service.editForumTopic('-100123', 17, 'Preventivo 2', account.id, { iconCustomEmojiId: '123456' });
    await service.setForumTopicIcon('-100123', 17, '123456', account.id);
    const createBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as Record<string, unknown>;
    const editBody = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body)) as Record<string, unknown>;
    const iconBody = JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(createBody).toMatchObject({ chat_id: '-100123', name: 'Preventivo', icon_custom_emoji_id: '123456' });
    expect(editBody).toMatchObject({ chat_id: '-100123', message_thread_id: 17, name: 'Preventivo 2', icon_custom_emoji_id: '123456' });
    expect(iconBody).toMatchObject({ chat_id: '-100123', message_thread_id: 17, icon_custom_emoji_id: '123456' });
    expect(iconBody).not.toHaveProperty('name');
  });

  it('riconosce un conflitto webhook e annulla il long polling', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '', token: '123:token' });
    const conflict = vi.fn(async () => new Response(JSON.stringify({ ok: false, error_code: 409, description: 'Conflict: webhook is active' }), { status: 409 }));
    const service = new TelegramService(store, conflict as unknown as typeof fetch);
    await expect(service.getUpdates(account.id, { timeoutSeconds: 0 })).rejects.toMatchObject({ code: 'telegram_conflict' });

    const pending = vi.fn((_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    }));
    const cancellable = new TelegramService(store, pending as unknown as typeof fetch);
    const controller = new AbortController();
    const request = cancellable.getUpdates(account.id, { timeoutSeconds: 25, signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: 'telegram_aborted' });
  });
});

describe('splitTelegramText', () => {
  it('preferisce gli a capo e non produce chunk vuoti', () => {
    const chunks = splitTelegramText(`${'a'.repeat(3000)}\n${'b'.repeat(3000)}`, 4000);
    expect(chunks).toHaveLength(2);
    expect(chunks.join('')).toContain('bbbb');
    expect(splitTelegramText('   ')).toEqual([]);
  });
});
