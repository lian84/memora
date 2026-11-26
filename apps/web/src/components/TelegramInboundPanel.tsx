import { useCallback, useEffect, useState } from 'react';
import type {
  AgentProfileSummary,
  ProjectRecord,
  TelegramAccountView,
  TelegramInboundAdminView,
  TelegramPairingCodeView,
  TelegramPollerStatus,
  TelegramReplyMode,
} from '@memora/shared';
import {
  addTelegramInboundUser,
  clearTelegramPairing,
  createTelegramPairing,
  getTelegramInbound,
  listAgentProfiles,
  listProjects,
  removeTelegramInboundBinding,
  removeTelegramInboundUser,
  updateTelegramInbound,
} from '../lib/api';
import { useI18n } from '../i18n';

interface TelegramInboundPanelProps {
  account: TelegramAccountView;
  onClose: () => void;
}

const STATUS_LABELS: Record<TelegramPollerStatus, string> = {
  disabled: 'Disabilitato',
  starting: 'Avvio…',
  running: 'In esecuzione',
  paused: 'In pausa',
  error: 'Errore',
  conflict: 'Conflitto webhook',
};

interface SettingsForm {
  defaultProjectId: string;
  defaultAgentProfileId: string;
  replyMode: TelegramReplyMode;
}

function settingsFrom(data: TelegramInboundAdminView): SettingsForm {
  return {
    defaultProjectId: data.inbound.settings.defaultProjectId ?? '',
    defaultAgentProfileId: data.inbound.settings.defaultAgentProfileId ?? '',
    replyMode: data.inbound.settings.replyMode,
  };
}

function formatTimestamp(value?: number): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export function TelegramInboundPanel({ account, onClose }: TelegramInboundPanelProps) {
  const { t } = useI18n();
  const [data, setData] = useState<TelegramInboundAdminView | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [agents, setAgents] = useState<AgentProfileSummary[]>([]);
  const [settings, setSettings] = useState<SettingsForm>({ defaultProjectId: '', defaultAgentProfileId: '', replyMode: 'final' });
  const [pairing, setPairing] = useState<TelegramPairingCodeView | null>(null);
  const [manualId, setManualId] = useState('');
  const [manualLabel, setManualLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getTelegramInbound(account.id);
      setData(next);
      setSettings(settingsFrom(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [account.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void Promise.all([listProjects(), listAgentProfiles()])
      .then(([projectList, agentList]) => {
        setProjects(projectList);
        setAgents(agentList);
      })
      .catch(() => undefined);
  }, []);

  const apply = (next: TelegramInboundAdminView, success: string): void => {
    setData(next);
    setSettings(settingsFrom(next));
    setMessage(success);
  };

  const toggleEnabled = async (): Promise<void> => {
    if (!data) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await updateTelegramInbound(account.id, { enabled: !data.inbound.enabled });
      if (!next.inbound.enabled) setPairing(null);
      apply(next, next.inbound.enabled ? t('Ingresso Telegram abilitato.') : t('Ingresso Telegram disabilitato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await updateTelegramInbound(account.id, {
        defaultProjectId: settings.defaultProjectId || null,
        defaultAgentProfileId: settings.defaultAgentProfileId || null,
        replyMode: settings.replyMode,
      });
      apply(next, t('Impostazioni ingresso salvate.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const generatePairing = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await createTelegramPairing(account.id);
      setPairing(next);
      await load();
      setMessage(t('Codice generato. Invialo al bot con /start <codice>.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const cancelPairing = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await clearTelegramPairing(account.id);
      setPairing(null);
      apply(next, t('Codice di associazione annullato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addUser = async (): Promise<void> => {
    const id = manualId.trim();
    if (!/^\d{1,20}$/.test(id)) {
      setError(t('Inserisci un ID utente Telegram numerico.'));
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await addTelegramInboundUser(account.id, {
        id,
        ...(manualLabel.trim() ? { label: manualLabel.trim() } : {}),
      });
      setManualId('');
      setManualLabel('');
      await load();
      setMessage(t('Utente Telegram aggiunto.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const removeUser = async (userId: string): Promise<void> => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await removeTelegramInboundUser(account.id, userId);
      await load();
      setMessage(t('Utente Telegram rimosso.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const removeBinding = async (userId: string): Promise<void> => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await removeTelegramInboundBinding(account.id, userId);
      await load();
      setMessage(t('Collegamento rimosso. La sessione resta disponibile nella web UI.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const status = data?.status;
  const statusLabel = status ? t(STATUS_LABELS[status.status]) : '—';

  return (
    <section className="telegram-inbound-panel" aria-label={t('Ingresso Telegram')}>
      <div className="telegram-inbound-head">
        <div>
          <h4>{t('Ingresso Telegram')}</h4>
          <p className="admin-card-description">
            {t('Il polling usa solo connessioni in uscita: nessuna porta pubblica. Sessioni e memoria sono le stesse della web UI, quindi autorizza solo i tuoi dispositivi.')}
          </p>
        </div>
        <button type="button" onClick={onClose}>{t('Chiudi')}</button>
      </div>

      {!account.tokenConfigured && (
        <div className="admin-alert is-error">{t('Token del bot mancante: aggiungilo prima di abilitare l’ingresso.')}</div>
      )}
      {!account.enabled && (
        <div className="admin-field-note">{t('L’account è disattivato: l’ingresso resterà fermo finché non lo riattivi.')}</div>
      )}
      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}
      {loading && <div className="admin-field-note">{t('Caricamento…')}</div>}

      {data && !loading && (
        <>
          <div className="telegram-inbound-status">
            <span className={`telegram-inbound-pill is-${data.status.status}`}>{statusLabel}</span>
            <span>{t('Bot')}: {data.status.botUsername ? `@${data.status.botUsername}` : '—'}</span>
            <span>{t('Ultimo update')}: {formatTimestamp(data.status.lastUpdateAt)}</span>
            <button type="button" onClick={() => void load()} disabled={loading || saving}>{t('Aggiorna stato')}</button>
          </div>
          {data.status.lastError && <div className="telegram-inbound-error">{data.status.lastError}</div>}

          <label className="admin-toggle">
            <input
              type="checkbox"
              checked={data.inbound.enabled}
              disabled={saving || (!account.tokenConfigured && !data.inbound.enabled)}
              onChange={() => void toggleEnabled()}
            />
            <span>{t('Abilita ingresso')}</span>
          </label>

          <div className="telegram-inbound-grid">
            <div className="telegram-inbound-block">
              <h5>{t('Codice di associazione')}</h5>
              <p className="admin-field-note">{t('Genera un codice monouso e invialo al bot con /start <codice>. Scade dopo dieci minuti.')}</p>
              {pairing ? (
                <div className="telegram-pairing-code">
                  <code>{pairing.code}</code>
                  <small>{t('Scade alle {time}', { time: formatTimestamp(pairing.expiresAt) })}</small>
                  {pairing.deepLink && (
                    <a href={pairing.deepLink} target="_blank" rel="noopener noreferrer">{t('Apri il bot su Telegram')} ↗</a>
                  )}
                </div>
              ) : data.inbound.pairing.active ? (
                <p className="admin-field-note">{t('Codice attivo fino alle {time}. Generane uno nuovo per vederlo.', { time: formatTimestamp(data.inbound.pairing.expiresAt) })}</p>
              ) : null}
              <div className="admin-actions">
                <button type="button" className="admin-primary" onClick={() => void generatePairing()} disabled={saving || !data.inbound.enabled || !account.tokenConfigured}>
                  {t('Genera codice')}
                </button>
                {data.inbound.pairing.active && (
                  <button type="button" onClick={() => void cancelPairing()} disabled={saving}>{t('Annulla codice')}</button>
                )}
              </div>
            </div>

            <div className="telegram-inbound-block">
              <h5>{t('Aggiungi ID manualmente')}</h5>
              <p className="admin-field-note">{t('Utile se conosci già l’ID numerico del tuo account Telegram.')}</p>
              <div className="admin-grid-2">
                <label className="admin-label">{t('ID utente Telegram')}
                  <input value={manualId} onChange={event => setManualId(event.target.value)} inputMode="numeric" placeholder="123456789" />
                </label>
                <label className="admin-label">{t('Etichetta (opzionale)')}
                  <input value={manualLabel} onChange={event => setManualLabel(event.target.value)} maxLength={80} placeholder={t('iPhone')} />
                </label>
              </div>
              <div className="admin-actions">
                <button type="button" onClick={() => void addUser()} disabled={saving}>{t('Aggiungi')}</button>
              </div>
            </div>
          </div>

          <div className="telegram-inbound-block">
            <h5>{t('Utenti autorizzati')}</h5>
            {data.inbound.allowedUsers.length === 0 ? (
              <p className="admin-field-note">{t('Nessun utente autorizzato.')}</p>
            ) : (
              <div className="telegram-inbound-list">
                {data.inbound.allowedUsers.map(user => (
                  <div className="telegram-inbound-row" key={user.id}>
                    <div>
                      <strong>{user.label}</strong>
                      <span>{t('ID Telegram')}: <code>{user.id}</code> · {t('Ultimo accesso')}: {formatTimestamp(user.lastSeenAt)}</span>
                    </div>
                    <button type="button" className="is-danger" onClick={() => void removeUser(user.id)} disabled={saving}>{t('Revoca')}</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="telegram-inbound-block">
            <h5>{t('Sessioni collegate')}</h5>
            {data.inbound.bindings.length === 0 ? (
              <p className="admin-field-note">{t('Nessuna sessione collegata. Il collegamento nasce al primo messaggio dopo l’associazione.')}</p>
            ) : (
              <div className="telegram-inbound-list">
                {data.inbound.bindings.map(binding => (
                  <div className="telegram-inbound-row" key={binding.userId}>
                    <div>
                      <strong>{t('Sessione')} <code>{binding.sessionId.slice(0, 18)}…</code></strong>
                      <span>{t('Utente')}: {binding.userId} · {t('Aggiornata')}: {formatTimestamp(binding.updatedAt)}</span>
                    </div>
                    <button type="button" className="is-danger" onClick={() => void removeBinding(binding.userId)} disabled={saving}>{t('Scollega')}</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="telegram-inbound-block">
            <h5>{t('Impostazioni nuove sessioni')}</h5>
            <div className="admin-grid-2">
              <label className="admin-label">{t('Progetto predefinito')}
                <select value={settings.defaultProjectId} onChange={event => setSettings(current => ({ ...current, defaultProjectId: event.target.value }))}>
                  <option value="">{t('Nessun progetto')}</option>
                  {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label className="admin-label">{t('Profilo agente predefinito')}
                <select value={settings.defaultAgentProfileId} onChange={event => setSettings(current => ({ ...current, defaultAgentProfileId: event.target.value }))}>
                  <option value="">{t('Memo base')}</option>
                  {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </label>
            </div>
            <label className="admin-label">{t('Modalità risposta')}
              <select value={settings.replyMode} onChange={event => setSettings(current => ({ ...current, replyMode: event.target.value as TelegramReplyMode }))}>
                <option value="final">{t('Risposta finale')}</option>
                <option value="progress" disabled>{t('Progressiva (sperimentale)')}</option>
              </select>
              <small>{t('La modalità progressiva non è ancora disponibile; per ora viene usata la risposta finale.')}</small>
            </label>
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={() => void saveSettings()} disabled={saving}>{t('Salva impostazioni')}</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
