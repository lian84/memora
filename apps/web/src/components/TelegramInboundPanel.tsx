import { useCallback, useEffect, useState } from 'react';
import type {
  AgentProfileSummary,
  ProjectRecord,
  TelegramAccountView,
  TelegramGroup,
  TelegramGroupPatch,
  TelegramInboundAdminView,
  TelegramPairingCodeView,
  TelegramPollerStatus,
  TelegramReplyMode,
} from '@memora/shared';
import {
  addTelegramInboundUser,
  clearTelegramPairing,
  createTelegramGroupPairing,
  createTelegramPairing,
  getTelegramInbound,
  listAgentProfiles,
  listTelegramGroups,
  listProjects,
  removeTelegramGroup,
  removeTelegramInboundBinding,
  removeTelegramInboundUser,
  resyncTelegramGroupTopics,
  updateTelegramGroup,
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

function telegramGroupLink(chatId: string, threadId?: string): string {
  const bare = chatId.startsWith('-100') ? chatId.slice(4) : chatId.replace(/^-/, '');
  return `https://t.me/c/${bare}${threadId ? `/${threadId}` : ''}`;
}

export function TelegramInboundPanel({ account, onClose }: TelegramInboundPanelProps) {
  const { t } = useI18n();
  const [data, setData] = useState<TelegramInboundAdminView | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [agents, setAgents] = useState<AgentProfileSummary[]>([]);
  const [settings, setSettings] = useState<SettingsForm>({ defaultProjectId: '', defaultAgentProfileId: '', replyMode: 'final' });
  const [pairing, setPairing] = useState<TelegramPairingCodeView | null>(null);
  const [groupPairing, setGroupPairing] = useState<TelegramPairingCodeView | null>(null);
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
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
      const [next, nextGroups] = await Promise.all([
        getTelegramInbound(account.id),
        listTelegramGroups(account.id),
      ]);
      setData(next);
      setSettings(settingsFrom(next));
      setGroups(nextGroups);
      if (!next.inbound.pairing.active) {
        setPairing(null);
        setGroupPairing(null);
      }
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
      if (!next.inbound.enabled) {
        setPairing(null);
        setGroupPairing(null);
      }
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
      });
      apply(next, t('Default account salvato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveReplyMode = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await updateTelegramInbound(account.id, { replyMode: settings.replyMode });
      setData(next);
      setMessage(t('Modalità risposta salvata.'));
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
      setGroupPairing(null);
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
      setGroupPairing(null);
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

  const generateGroupPairing = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await createTelegramGroupPairing(account.id);
      setGroupPairing(next);
      setPairing(null);
      await load();
      setMessage(t('Codice gruppo generato. Invialo nel topic General con /start <codice>.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const removeGroup = async (chatId: string): Promise<void> => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await removeTelegramGroup(account.id, chatId);
      setGroupPairing(null);
      await load();
      setMessage(t('Gruppo rimosso. Le sessioni restano nella web UI.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateGroup = async (chatId: string, patch: TelegramGroupPatch, success: string): Promise<void> => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateTelegramGroup(account.id, chatId, patch);
      setGroups(current => current.map(group => group.chatId === chatId ? updated : group));
      setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const resyncGroup = async (chatId: string): Promise<void> => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await resyncTelegramGroupTopics(account.id, chatId);
      setMessage(t('Titoli riallineati: {updated}. Errori: {failed}.', { updated: result.updated, failed: result.failed }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const projectLabel = (projectId?: string | null): string => {
    if (!projectId) return '—';
    return projects.find(project => project.id === projectId)?.name ?? projectId;
  };

  const agentLabel = (agentId?: string | null): string => {
    if (!agentId) return t('Memo base');
    return agents.find(agent => agent.id === agentId)?.name ?? agentId;
  };

  const activeProjects = projects.filter(project => project.status === 'active');

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
            <h5>{t('Gruppi forum')}</h5>
            <p className="admin-field-note">
              {t('Usa un supergruppo privato con Topics attivi, solo proprietario e bot. Il topic General è la sessione predefinita; ogni topic secondario è una sessione.')}
            </p>
            <p className="admin-field-note">
              {t('Il topic usa il proprio progetto; se assente usa il progetto del gruppo; se assente il default dell’account. Il progetto di una sessione non cambia dopo la creazione.')}
            </p>
            {groupPairing ? (
              <div className="telegram-pairing-code">
                <code>{groupPairing.code}</code>
                <small>{t('Scade alle {time}', { time: formatTimestamp(groupPairing.expiresAt) })}</small>
                <p className="admin-field-note">{t('Invia /start <codice> nel topic General del gruppo. Il bot deve essere amministratore con Manage Topics.')}</p>
              </div>
            ) : data.inbound.pairing.active ? (
              <p className="admin-field-note">{t('Codice attivo fino alle {time}. Generane uno nuovo per vederlo.', { time: formatTimestamp(data.inbound.pairing.expiresAt) })}</p>
            ) : null}
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={() => void generateGroupPairing()} disabled={saving || !data.inbound.enabled || !account.tokenConfigured}>
                {t('Genera codice gruppo')}
              </button>
            </div>
            {groups.length === 0 ? (
              <p className="admin-field-note">{t('Nessun gruppo associato. Genera un codice e invialo in General.')}</p>
            ) : (
              <div className="telegram-inbound-list">
                {groups.map(group => {
                  const accountDefaultProjectId = data.inbound.settings.defaultProjectId;
                  const accountDefaultAgentId = data.inbound.settings.defaultAgentProfileId;
                  const effectiveProjectId = group.defaultProjectId ?? accountDefaultProjectId;
                  const effectiveAgentId = group.defaultAgentProfileId ?? accountDefaultAgentId;
                  const projectInherited = !group.defaultProjectId && Boolean(accountDefaultProjectId);
                  const agentInherited = !group.defaultAgentProfileId && Boolean(accountDefaultAgentId);
                  const effectiveProject = projectLabel(effectiveProjectId);
                  const effectiveAgent = agentLabel(effectiveAgentId);
                  const defaultProjectMissing = Boolean(group.defaultProjectId && !activeProjects.some(project => project.id === group.defaultProjectId));
                  const defaultAgentMissing = Boolean(group.defaultAgentProfileId && !agents.some(agent => agent.id === group.defaultAgentProfileId));
                  return (
                    <div className="telegram-inbound-row" key={group.chatId}>
                      <div>
                        <strong>{group.title}</strong>
                        <span>
                          <code>{group.chatId}</code> · {group.isForum ? t('Forum') : t('Non forum')} · {t('Aggiornato')}: {formatTimestamp(group.updatedAt)}
                        </span>
                        <span>
                          {t('General')}: {group.generalSessionId ? <a href={telegramGroupLink(group.chatId, '1')} target="_blank" rel="noopener noreferrer">{t('apri')} ↗</a> : t('non ancora avviato')} · {t('Progetto')}: {effectiveProject}
                        </span>
                        {Object.values(group.topics).length > 0 && (
                          <span>
                            {t('Topic')}: {Object.values(group.topics).map((topic, index) => (
                              <span key={topic.threadId}>
                                {index > 0 ? ' · ' : ''}
                                <a href={telegramGroupLink(group.chatId, topic.threadId)} target="_blank" rel="noopener noreferrer">{topic.title}</a> ({projectLabel(topic.projectId ?? effectiveProjectId)} · {agentLabel(topic.agentProfileId ?? effectiveAgentId)})
                              </span>
                            ))}
                          </span>
                        )}
                        <span>{t('Utenti autorizzati')}: {group.allowedUsers.join(', ')}</span>
                        <div className="telegram-group-summary">
                          <span>{t('Progetto effettivo')}: {effectiveProject}{projectInherited ? ` (${t('ereditato')})` : ''}</span>
                          <span>{t('Profilo effettivo')}: {effectiveAgent}{agentInherited ? ` (${t('ereditato')})` : ''}</span>
                          <span>{t('Prefisso progetto')}: {group.showProjectInTopicTitle ? t('attivo') : t('disattivato')}</span>
                        </div>
                        <details className="telegram-group-config">
                          <summary>{t('Configura')}</summary>
                          <div className="telegram-group-settings">
                            <label className="admin-label">{t('Progetto del gruppo')}
                              <select
                                value={group.defaultProjectId ?? ''}
                                disabled={saving}
                                onChange={event => void updateGroup(group.chatId, { defaultProjectId: event.target.value || null }, t('Progetto del gruppo salvato.'))}
                              >
                                <option value="">{t('Eredita default account')}{accountDefaultProjectId ? `: ${projectLabel(accountDefaultProjectId)}` : ''}</option>
                                {defaultProjectMissing && <option value={group.defaultProjectId ?? ''}>{group.defaultProjectId}</option>}
                                {activeProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                              </select>
                            </label>
                            <label className="admin-label">{t('Profilo agente del gruppo')}
                              <select
                                value={group.defaultAgentProfileId ?? ''}
                                disabled={saving}
                                onChange={event => void updateGroup(group.chatId, { defaultAgentProfileId: event.target.value || null }, t('Profilo agente del gruppo salvato.'))}
                              >
                                <option value="">{t('Eredita default account')}: {agentLabel(accountDefaultAgentId)}</option>
                                {defaultAgentMissing && <option value={group.defaultAgentProfileId ?? ''}>{group.defaultAgentProfileId}</option>}
                                {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                              </select>
                            </label>
                            <p className="admin-field-note">
                              {t('Il prefisso e l’icona valgono per i nuovi topic e /rename; Riallinea titoli e icone aggiorna quelli esistenti.')}
                            </p>
                            <label className="admin-toggle">
                              <input
                                type="checkbox"
                                checked={group.showProjectInTopicTitle}
                                disabled={saving}
                                onChange={event => void updateGroup(group.chatId, { showProjectInTopicTitle: event.target.checked }, t('Impostazione prefisso aggiornata.'))}
                              />
                              <span>{t('Mostra il progetto nei titoli dei topic')}</span>
                            </label>
                            <button type="button" onClick={() => void resyncGroup(group.chatId)} disabled={saving}>
                              {t('Riallinea titoli e icone')}
                            </button>
                          </div>
                        </details>
                      </div>
                      <button type="button" className="is-danger" onClick={() => void removeGroup(group.chatId)} disabled={saving}>{t('Revoca')}</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="telegram-inbound-block">
            <h5>{t('Default account')}</h5>
            <p className="admin-field-note">{t('Valori usati dalle DM e dai gruppi senza override.')}</p>
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
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={() => void saveSettings()} disabled={saving}>{t('Salva default account')}</button>
            </div>
          </div>

          <div className="telegram-inbound-block">
            <h5>{t('Risposte')}</h5>
            <label className="admin-label">{t('Modalità risposta')}
              <select value={settings.replyMode} onChange={event => setSettings(current => ({ ...current, replyMode: event.target.value as TelegramReplyMode }))}>
                <option value="final">{t('Risposta finale')}</option>
                <option value="progress" disabled>{t('Progressiva (sperimentale)')}</option>
              </select>
              <small>{t('La modalità progressiva non è ancora disponibile; per ora viene usata la risposta finale.')}</small>
            </label>
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={() => void saveReplyMode()} disabled={saving}>{t('Salva risposta')}</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
