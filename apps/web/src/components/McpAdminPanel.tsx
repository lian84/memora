import { useCallback, useEffect, useMemo, useState } from 'react';
import { MCP_SERVER_DEFINITIONS, type McpAccount, type McpServerId } from '@memora/shared';
import { createMcpAccount, deleteMcpAccount, listMcpAccounts, updateMcpAccount } from '../lib/api';
import { useI18n } from '../i18n';
import { ConfirmDialog } from './ConfirmDialog';

interface AccountForm {
  serverId: McpServerId;
  label: string;
  secretRef: string;
  defaultForServer: boolean;
}

const EMPTY_FORM: AccountForm = { serverId: 'notion', label: '', secretRef: '', defaultForServer: false };

export function McpAdminPanel() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<McpAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<McpAccount | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await listMcpAccounts());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const globals = useMemo(() => accounts.filter(account => account.scope === 'global'), [accounts]);
  const projects = useMemo(() => accounts.filter(account => account.scope === 'project'), [accounts]);

  const startNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setMessage(null);
  };

  const startEdit = (account: McpAccount) => {
    setEditingId(account.id);
    setForm({
      serverId: account.serverId,
      label: account.label,
      secretRef: account.secretRef,
      defaultForServer: account.defaultForServer,
    });
    setError(null);
    setMessage(null);
  };

  const save = async () => {
    if (!form.label.trim()) { setError(t('Il nome dell’account è obbligatorio.')); return; }
    if (!/^(?:env:[A-Z_][A-Z0-9_]*|secret:[a-z0-9][a-z0-9:._-]{1,160})$/.test(form.secretRef.trim())) {
      setError(t('Usa env:NOME_VARIABILE oppure secret:chiave per il token.'));
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        serverId: form.serverId,
        label: form.label.trim(),
        secretRef: form.secretRef.trim(),
        defaultForServer: form.defaultForServer,
      };
      if (editingId) await updateMcpAccount(editingId, payload);
      else await createMcpAccount({ ...payload, scope: 'global' });
      await load();
      setEditingId(null);
      setForm(EMPTY_FORM);
      setMessage(editingId ? t('Account aggiornato.') : t('Account globale creato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setError(null);
    try {
      await deleteMcpAccount(deleteTarget.id);
      setDeleteTarget(null);
      await load();
      if (editingId === deleteTarget.id) startNew();
      setMessage(t('Account eliminato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const serverLabel = (id: McpServerId) => MCP_SERVER_DEFINITIONS.find(server => server.id === id)?.label ?? id;

  return (
    <div className="mcp-admin">
      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}
      <div className="admin-card-description">
        {t('Gli account globali sono disponibili per tutti i progetti. I token non vengono salvati qui: usa un riferimento env: o secret:.')}
      </div>

      <div className="mcp-admin-layout">
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h3>{t('Account globali')}</h3>
              <p className="admin-card-description">{t('Notion e Todoist. Un account predefinito per server.')}</p>
            </div>
            <button type="button" className="admin-primary" onClick={startNew}>+ {t('Nuovo account')}</button>
          </div>
          {loading && <div className="admin-field-note">{t('Caricamento…')}</div>}
          {!loading && globals.length === 0 && <div className="admin-field-note">{t('Nessun account globale configurato.')}</div>}
          <div className="mcp-account-list">
            {globals.map(account => (
              <div className={`mcp-account-row${editingId === account.id ? ' is-selected' : ''}`} key={account.id}>
                <button type="button" className="mcp-account-main" onClick={() => startEdit(account)}>
                  <strong>{account.label}</strong>
                  <span>{serverLabel(account.serverId)}{account.defaultForServer ? ` · ${t('predefinito')}` : ''}</span>
                  <small>{account.secretRef}</small>
                </button>
                <button type="button" className="mcp-account-delete" aria-label={t('Elimina account')} title={t('Elimina account')} onClick={() => setDeleteTarget(account)}>×</button>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-card">
          <h3>{editingId ? t('Modifica account globale') : t('Nuovo account globale')}</h3>
          <label className="admin-label">{t('Server')}
            <select value={form.serverId} onChange={event => setForm(current => ({ ...current, serverId: event.target.value as McpServerId }))} disabled={Boolean(editingId)}>
              {MCP_SERVER_DEFINITIONS.map(server => <option key={server.id} value={server.id}>{server.label}</option>)}
            </select>
          </label>
          <label className="admin-label">{t('Nome account')}
            <input value={form.label} onChange={event => setForm(current => ({ ...current, label: event.target.value }))} placeholder="Lavoro" maxLength={120} />
          </label>
          <label className="admin-label">{t('Riferimento token')}
            <input value={form.secretRef} onChange={event => setForm(current => ({ ...current, secretRef: event.target.value }))} placeholder="env:NOTION_WORK_TOKEN" spellCheck={false} />
            <small>{t('Non inserire il token qui. Usa env:NOME_VARIABILE o secret:chiave.')}</small>
          </label>
          <label className="admin-toggle">
            <input type="checkbox" checked={form.defaultForServer} onChange={event => setForm(current => ({ ...current, defaultForServer: event.target.checked }))} disabled={Boolean(editingId) && !globals.some(item => item.id === editingId && item.serverId === form.serverId)} />
            <span>{t('Account predefinito per questo server')}</span>
          </label>
          <div className="admin-actions">
            <button type="button" className="admin-primary" onClick={() => void save()} disabled={saving}>{saving ? t('Salvo…') : t('Salva account')}</button>
            {editingId && <button type="button" onClick={startNew}>{t('Annulla')}</button>}
          </div>
        </section>
      </div>

      {projects.length > 0 && (
        <section className="admin-card">
          <h3>{t('Account dedicati ai progetti')}</h3>
          <p className="admin-card-description">{t('Sono creati dalle impostazioni del progetto e non sono disponibili agli altri progetti.')}</p>
          <div className="mcp-project-account-list">
            {projects.map(account => (
              <div className="mcp-project-account" key={account.id}>
                <strong>{account.label}</strong>
                <span>{serverLabel(account.serverId)} · {account.projectId}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t('Eliminare l’account “{name}”?', { name: deleteTarget.label })}
          confirmLabel={t('Elimina account')}
          busy={saving}
          error={error}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>{t('Le chat e i progetti che lo usano dovranno scegliere un altro account.')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
