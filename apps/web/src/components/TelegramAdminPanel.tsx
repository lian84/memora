import { useCallback, useEffect, useState } from 'react';
import type { TelegramAccountInput, TelegramAccountView, TelegramChat } from '@memora/shared';
import {
  createTelegramAccount,
  deleteTelegramAccount,
  discoverTelegramChats,
  listTelegramAccounts,
  testTelegramAccount,
  updateTelegramAccount,
} from '../lib/api';
import { useI18n } from '../i18n';
import { ConfirmDialog } from './ConfirmDialog';
import { TelegramInboundPanel } from './TelegramInboundPanel';

interface AccountForm {
  label: string;
  chatId: string;
  token: string;
  enabled: boolean;
}

const EMPTY_FORM: AccountForm = { label: '', chatId: '', token: '', enabled: true };

export function TelegramAdminPanel() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<TelegramAccountView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TelegramAccountView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [chatsFor, setChatsFor] = useState<string | null>(null);
  const [chats, setChats] = useState<TelegramChat[]>([]);
  const [inboundFor, setInboundFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await listTelegramAccounts());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const editingAccount = editingId ? accounts.find(account => account.id === editingId) : undefined;

  const startNew = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setError(null);
    setMessage(null);
  };

  const startEdit = (account: TelegramAccountView) => {
    setEditingId(account.id);
    setForm({ label: account.label, chatId: account.chatId, token: '', enabled: account.enabled });
    setError(null);
    setMessage(null);
  };

  const save = async () => {
    if (!form) return;
    if (!form.label.trim()) { setError(t('Il nome dell’account Telegram è obbligatorio.')); return; }
    if (!editingId && !form.token.trim()) { setError(t('Inserisci il token del bot Telegram.')); return; }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const input: TelegramAccountInput = {
        label: form.label.trim(),
        chatId: form.chatId.trim(),
        enabled: form.enabled,
        ...(form.token.trim() ? { token: form.token.trim() } : {}),
      };
      if (editingId) await updateTelegramAccount(editingId, input);
      else await createTelegramAccount(input);
      await load();
      setEditingId(null);
      setForm(null);
      setMessage(t(editingId ? 'Account Telegram aggiornato.' : 'Account Telegram creato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (account: TelegramAccountView) => {
    setBusyId(account.id);
    setError(null);
    try {
      await updateTelegramAccount(account.id, { enabled: !account.enabled });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const test = async (account: TelegramAccountView) => {
    setBusyId(account.id);
    setError(null);
    try {
      await testTelegramAccount(account.id);
      setMessage(t('Messaggio di prova inviato su Telegram.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const discover = async (account: TelegramAccountView) => {
    setBusyId(account.id);
    setError(null);
    setChats([]);
    setChatsFor(account.id);
    try {
      const found = await discoverTelegramChats(account.id);
      setChats(found);
      setMessage(found.length === 0 ? t('Nessuna chat trovata. Scrivi /start al bot da Telegram e riprova.') : t('Chat Telegram trovate. Seleziona quella da usare.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const chooseChat = async (account: TelegramAccountView, chat: TelegramChat) => {
    setBusyId(account.id);
    setError(null);
    try {
      await updateTelegramAccount(account.id, { chatId: chat.id });
      await load();
      setChatsFor(null);
      setChats([]);
      setMessage(t('Chat ID Telegram aggiornato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setError(null);
    try {
      await deleteTelegramAccount(deleteTarget.id);
      if (editingId === deleteTarget.id) { setEditingId(null); setForm(null); }
      if (inboundFor === deleteTarget.id) setInboundFor(null);
      setDeleteTarget(null);
      await load();
      setMessage(t('Account Telegram eliminato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="telegram-admin">
      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}

      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h3>{t('Account Telegram')}</h3>
            <p className="admin-card-description">{t('Crea qui gli account Telegram. Ogni automazione può sceglierne uno e lo stesso account può essere usato da più automazioni. I token restano nel secret store locale.')}</p>
          </div>
          <button type="button" className="admin-primary" onClick={startNew}>{t('Nuovo account Telegram')}</button>
        </div>

        {loading && <div className="admin-field-note">{t('Caricamento…')}</div>}
        {!loading && accounts.length === 0 && <div className="second-brain-empty">{t('Nessun account Telegram configurato.')}</div>}
        {!loading && accounts.length > 0 && (
          <div className="telegram-account-list">
            {accounts.map(account => (
              <div className="telegram-account-entry" key={account.id}>
                <div className={`telegram-account${account.enabled ? '' : ' is-disabled'}`}>
                  <div className="telegram-account-main">
                    <div className="telegram-account-head">
                      <strong>{account.label}</strong>
                      <span className={`automation-pill${account.tokenConfigured && account.chatId ? ' is-ok' : ''}`}>{account.tokenConfigured && account.chatId ? t('Configurato') : t('Da configurare')}</span>
                      {!account.enabled && <span className="automation-status">{t('Disattivato')}</span>}
                    </div>
                    <div className="telegram-account-meta">
                      <span>{t('Chat ID')}: <code>{account.chatId || '—'}</code></span>
                      <span>{account.tokenSource === 'environment' ? t('Token da ambiente') : account.tokenConfigured ? t('Token nel secret store') : t('Token mancante')}</span>
                    </div>
                    {chatsFor === account.id && chats.length > 0 && (
                      <div className="automation-discovery">
                        {chats.map(chat => (
                          <button type="button" key={chat.id} onClick={() => void chooseChat(account, chat)}>
                            <strong>{chat.label}</strong><span>{chat.id} · {chat.type}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="telegram-account-actions">
                    <label className="admin-toggle automation-toggle">
                      <input type="checkbox" checked={account.enabled} disabled={busyId === account.id} onChange={() => void toggleEnabled(account)} />
                      <span>{t('Attivo')}</span>
                    </label>
                    <button type="button" onClick={() => void discover(account)} disabled={busyId === account.id || !account.tokenConfigured}>{t('Cerca chat')}</button>
                    <button type="button" onClick={() => void test(account)} disabled={busyId === account.id || !account.tokenConfigured || !account.chatId}>{t('Invia test')}</button>
                    <button type="button" onClick={() => setInboundFor(current => current === account.id ? null : account.id)}>{t('Ingresso')}</button>
                    <button type="button" onClick={() => startEdit(account)}>{t('Modifica')}</button>
                    <button type="button" className="is-danger" onClick={() => setDeleteTarget(account)}>{t('Elimina')}</button>
                  </div>
                </div>
                {inboundFor === account.id && (
                  <TelegramInboundPanel account={account} onClose={() => setInboundFor(null)} />
                )}
              </div>
            ))}
          </div>
        )}

        {form && (
          <div className="automation-editor telegram-account-editor">
            <h4>{editingId ? t('Modifica account Telegram') : t('Nuovo account Telegram')}</h4>
            <div className="admin-grid-2">
              <label className="admin-label">{t('Nome account')}
                <input value={form.label} onChange={event => setForm(current => current ? { ...current, label: event.target.value } : current)} maxLength={80} placeholder={t('Personale')} />
              </label>
              <label className="admin-label">{t('Chat ID')}
                <input value={form.chatId} onChange={event => setForm(current => current ? { ...current, chatId: event.target.value } : current)} placeholder="-1001234567890" inputMode="numeric" />
                <small>{t('Puoi inserirlo manualmente oppure salvarlo e usare “Cerca chat”.')}</small>
              </label>
            </div>
            <label className="admin-label">{t('Token bot')}
              <input type="password" value={form.token} onChange={event => setForm(current => current ? { ...current, token: event.target.value } : current)} placeholder={editingId ? t('Lascia vuoto per mantenere il token attuale') : '123456:ABC...'} autoComplete="new-password" spellCheck={false} disabled={editingAccount?.tokenSource === 'environment'} />
              <small>{editingAccount?.tokenSource === 'environment' ? t('Token gestito dalla variabile MEMORA_TELEGRAM_BOT_TOKEN.') : t('Salvato in config/telegram-secrets.json con permessi 0600. Non viene mai restituito dall’API.')}</small>
            </label>
            <div className="admin-grid-2">
              <label className="admin-toggle">
                <input type="checkbox" checked={form.enabled} onChange={event => setForm(current => current ? { ...current, enabled: event.target.checked } : current)} />
                <span>{t('Account attivo')}</span>
              </label>
              <a className="admin-token-link" href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">{t('Apri BotFather')} ↗</a>
            </div>
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={() => void save()} disabled={saving}>{saving ? t('Salvo…') : t('Salva account')}</button>
              <button type="button" onClick={() => { setForm(null); setEditingId(null); }} disabled={saving}>{t('Annulla')}</button>
            </div>
          </div>
        )}
      </section>

      {deleteTarget && (
        <ConfirmDialog
          title={t('Eliminare l’account Telegram?')}
          confirmLabel={t('Elimina')}
          busy={saving}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>{t('Le automazioni che usano questo account non potranno più inviare risultati finché non ne scegli un altro.')}</p>
          <p><strong>{deleteTarget.label}</strong></p>
        </ConfirmDialog>
      )}
    </div>
  );
}
