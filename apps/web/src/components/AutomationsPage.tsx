import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MCP_SERVER_DEFINITIONS,
  type AutomationJob,
  type AutomationJobInput,
  type AutomationRun,
  type McpServerId,
  type ProjectRecord,
  type TelegramAccountView,
  type AgentProfileSummary,
} from '@memora/shared';
import {
  createAutomation,
  deleteAutomation,
  getWebStatus,
  listAgentProfiles,
  listAutomationRuns,
  listAutomations,
  listMcpAccounts,
  listTelegramAccounts,
  listProjects,
  runAutomation,
  updateAutomation,
  type WebStatus,
} from '../lib/api';
import { useI18n } from '../i18n';
import { ConfirmDialog } from './ConfirmDialog';

interface JobForm {
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  projectId: string;
  agentProfileId: string;
  mcpEnabled: McpServerId[];
  allowWrites: boolean;
  notifyTelegram: boolean;
  webEnabled: boolean;
  telegramAccountId: string;
  timeoutMinutes: number;
}

const CRON_PRESETS = [
  { label: 'Ogni giorno alle 09:00', cron: '0 9 * * *' },
  { label: 'Ogni giorno alle 18:00', cron: '0 18 * * *' },
  { label: 'Ogni lunedì alle 08:30', cron: '30 8 * * 1' },
  { label: 'Ogni ora', cron: '0 * * * *' },
] as const;

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';
  } catch {
    return 'Europe/Rome';
  }
}

function emptyForm(defaultProjectId?: string | null): JobForm {
  return {
    name: '',
    prompt: '',
    cron: '0 9 * * *',
    timezone: browserTimezone(),
    enabled: true,
    projectId: defaultProjectId ?? '',
    agentProfileId: '',
    mcpEnabled: [],
    allowWrites: false,
    notifyTelegram: false,
    webEnabled: false,
    telegramAccountId: '',
    timeoutMinutes: 10,
  };
}

function formFromJob(job: AutomationJob): JobForm {
  return {
    name: job.name,
    prompt: job.prompt,
    cron: job.cron,
    timezone: job.timezone,
    enabled: job.enabled,
    projectId: job.projectId ?? '',
    agentProfileId: job.agentProfileId ?? '',
    mcpEnabled: job.mcp.enabled,
    allowWrites: job.mcp.allowWrites === true,
    notifyTelegram: job.notifyTelegram,
    webEnabled: job.webEnabled,
    telegramAccountId: job.telegramAccountId ?? '',
    timeoutMinutes: job.timeoutMinutes,
  };
}

function runStatusLabel(status: AutomationRun['status']): string {
  if (status === 'completed') return 'Completata';
  if (status === 'failed') return 'Fallita';
  if (status === 'timeout') return 'Timeout';
  if (status === 'interrupted') return 'Interrotta';
  return 'In esecuzione';
}

interface AutomationsPageProps {
  /** Progetto preselezionato quando si crea una nuova automazione. */
  defaultProjectId?: string | null;
  /** Automazione da aprire subito (selezione dalla sidebar). */
  focusJobId?: string | null;
  /** Apre direttamente il form di creazione. */
  startCreate?: boolean;
  onClose?: () => void;
  onChanged?: () => void;
}

export function AutomationsPage({ defaultProjectId = null, focusJobId = null, startCreate = false, onClose, onChanged }: AutomationsPageProps) {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [telegramAccounts, setTelegramAccounts] = useState<TelegramAccountView[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [profiles, setProfiles] = useState<AgentProfileSummary[]>([]);
  const [accountsCount, setAccountsCount] = useState(0);
  const [webStatus, setWebStatus] = useState<WebStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<JobForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationJob | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [runsJobId, setRunsJobId] = useState<string | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const initializedRef = useRef(false);


  const notifyChanged = useCallback(() => {
    onChanged?.();
  }, [onChanged]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, nextProjects, nextProfiles, accounts, nextTelegramAccounts, nextWebStatus] = await Promise.all([
        listAutomations(),
        listProjects(),
        listAgentProfiles(),
        listMcpAccounts(),
        listTelegramAccounts(),
        getWebStatus().catch(() => null),
      ]);
      setJobs(data.jobs);
      setTelegramAccounts(nextTelegramAccounts);
      setProjects(nextProjects.filter(project => project.status !== 'archived'));
      setProfiles(nextProfiles);
      setAccountsCount(accounts.length);
      setWebStatus(nextWebStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!runsJobId) return;
    let cancelled = false;
    const refresh = async (initial: boolean) => {
      if (initial) setRunsLoading(true);
      try {
        const next = await listAutomationRuns(runsJobId);
        if (!cancelled) setRuns(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled && initial) setRunsLoading(false);
      }
    };
    void refresh(true);
    const timer = window.setInterval(() => { void refresh(false); }, 2_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [runsJobId]);

  useEffect(() => {
    if (loading || initializedRef.current) return;
    initializedRef.current = true;
    if (focusJobId) {
      const job = jobs.find(item => item.id === focusJobId);
      if (job) startEdit(job);
      return;
    }
    if (startCreate) startNew();
  }, [focusJobId, jobs, loading, startCreate]);

  const projectName = useMemo(() => new Map(projects.map(project => [project.id, project.name])), [projects]);
  const profileName = useMemo(() => new Map(profiles.map(profile => [profile.id, profile.name])), [profiles]);
  const telegramAccountName = useMemo(() => new Map(telegramAccounts.map(account => [account.id, account.label])), [telegramAccounts]);
  const defaultTelegramAccount = telegramAccounts.find(account => account.enabled) ?? telegramAccounts[0];

  const startNew = () => {
    setEditingId(null);
    const firstAccount = telegramAccounts.find(account => account.enabled) ?? telegramAccounts[0];
    setForm({ ...emptyForm(defaultProjectId), telegramAccountId: firstAccount?.id ?? '', notifyTelegram: false });
    setError(null);
    setMessage(null);
  };

  const startEdit = (job: AutomationJob) => {
    setEditingId(job.id);
    setForm(formFromJob(job));
    setError(null);
    setMessage(null);
  };

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) { setError(t('Il nome dell’automazione è obbligatorio.')); return; }
    if (!form.prompt.trim()) { setError(t('Il prompt dell’automazione è obbligatorio.')); return; }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const input: AutomationJobInput = {
        name: form.name.trim(),
        prompt: form.prompt,
        cron: form.cron.trim(),
        timezone: form.timezone.trim(),
        enabled: form.enabled,
        projectId: form.projectId || null,
        agentProfileId: form.agentProfileId || null,
        mcp: { enabled: form.mcpEnabled, ...(form.allowWrites ? { allowWrites: true } : {}) },
        notifyTelegram: form.notifyTelegram,
        webEnabled: form.webEnabled,
        telegramAccountId: form.notifyTelegram ? (form.telegramAccountId || null) : null,
        timeoutMinutes: form.timeoutMinutes,
      };
      if (editingId) await updateAutomation(editingId, input);
      else await createAutomation(input);
      setEditingId(null);
      setForm(null);
      await load();
      notifyChanged();
      setMessage(editingId ? t('Automazione aggiornata.') : t('Automazione creata.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (job: AutomationJob) => {
    setError(null);
    try {
      await updateAutomation(job.id, { enabled: !job.enabled });
      await load();
      notifyChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setError(null);
    try {
      await deleteAutomation(deleteTarget.id);
      if (editingId === deleteTarget.id) { setEditingId(null); setForm(null); }
      if (runsJobId === deleteTarget.id) { setRunsJobId(null); setRuns([]); }
      setDeleteTarget(null);
      await load();
      notifyChanged();
      setMessage(t('Automazione eliminata.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const runNow = async (job: AutomationJob) => {
    setError(null);
    setMessage(null);
    try {
      await runAutomation(job.id);
      setRunningIds(current => [...current, job.id]);
      setMessage(t('Automazione avviata. La esecuzione avviene sul server, anche a browser chiuso.'));
      notifyChanged();
      window.setTimeout(() => {
        void load();
        notifyChanged();
        setRunningIds(current => current.filter(id => id !== job.id));
      }, 2_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunningIds(current => current.filter(id => id !== job.id));
    }
  };

  const showRuns = (jobId: string) => {
    setRuns([]);
    setRunsJobId(jobId);
  };

  return (
    <div className="automations-admin">
      <div className="automation-page-header">
        <div>
          <span className="admin-eyebrow">{t('Attività pianificate')}</span>
          <h2>{t('Automazioni')}</h2>
          <p>{t('Crea automazioni dentro un progetto o fuori dai progetti. Girano sul server anche a browser chiuso.')}</p>
        </div>
        {onClose && <button type="button" className="admin-close" onClick={onClose}>{t('Torna alla chat')}</button>}
      </div>
      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}

      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h3>{t('Attività pianificate')}</h3>
            <p className="admin-card-description">{t('Lo scheduler gira nel servizio Memora: non richiede il browser aperto. Ogni esecuzione crea una sessione dedicata e salva il risultato nella cronologia.')}</p>
          </div>
          <button type="button" className="admin-primary" onClick={startNew}>{t('Nuova automazione')}</button>
        </div>

        {loading && <div className="admin-field-note">{t('Caricamento…')}</div>}
        {!loading && jobs.length === 0 && <div className="second-brain-empty">{t('Nessuna automazione configurata.')}</div>}
        {!loading && jobs.length > 0 && (
          <div className="automation-list">
            {jobs.map(job => (
              <div className={`automation-row${job.enabled ? '' : ' is-disabled'}`} key={job.id}>
                <div className="automation-row-main">
                  <div className="automation-row-head">
                    <strong>{job.name}</strong>
                    <span className={`automation-status status-${job.lastRunStatus ?? 'never'}`}>{job.lastRunStatus ? t(runStatusLabel(job.lastRunStatus)) : t('Mai eseguita')}</span>
                    {runningIds.includes(job.id) && <span className="automation-status status-running">{t('In esecuzione')}</span>}
                  </div>
                  <div className="automation-row-meta">
                    <span><code>{job.cron}</code> · {job.timezone}</span>
                    <span>{job.nextRunAt ? `${t('Prossima')}: ${new Date(job.nextRunAt).toLocaleString(undefined, { timeZone: job.timezone })}` : t('Disattivata')}</span>
                    {job.projectId && <span>{t('Progetto')}: {projectName.get(job.projectId) ?? job.projectId}</span>}
                    {job.agentProfileId && <span>{t('Agente')}: {profileName.get(job.agentProfileId) ?? job.agentProfileId}</span>}
                    {job.webEnabled && <span>{t('Ricerca web')}</span>}
                    {job.notifyTelegram && <span>Telegram: {job.telegramAccountId ? telegramAccountName.get(job.telegramAccountId) ?? job.telegramAccountId : defaultTelegramAccount?.label ?? t('account predefinito')}</span>}
                    {job.mcp.enabled.length > 0 && <span>MCP: {job.mcp.enabled.join(', ')}{job.mcp.allowWrites ? ` · ${t('scritture')}` : ''}</span>}
                  </div>
                  {job.lastRunAt && <span className="automation-last-run">{t('Ultima esecuzione')}: {new Date(job.lastRunAt).toLocaleString(undefined, { timeZone: job.timezone })}</span>}
                </div>
                <div className="automation-row-actions">
                  <label className="admin-toggle automation-toggle">
                    <input type="checkbox" checked={job.enabled} onChange={() => void toggleEnabled(job)} />
                    <span>{t('Attiva')}</span>
                  </label>
                  <button type="button" onClick={() => void runNow(job)} disabled={runningIds.includes(job.id)}>{t('Esegui ora')}</button>
                  <button type="button" onClick={() => void showRuns(job.id)}>{t('Cronologia')}</button>
                  <button type="button" onClick={() => startEdit(job)}>{t('Modifica')}</button>
                  <button type="button" className="is-danger" onClick={() => setDeleteTarget(job)}>{t('Elimina')}</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {form && (
          <div className="automation-editor">
            <h4>{editingId ? t('Modifica automazione') : t('Nuova automazione')}</h4>
            <div className="admin-grid-2">
              <label className="admin-label">{t('Nome')}
                <input value={form.name} onChange={event => setForm(current => current ? { ...current, name: event.target.value } : current)} maxLength={120} placeholder={t('Riepilogo del lunedì')} />
              </label>
              <label className="admin-label">{t('Timeout (minuti)')}
                <input type="number" min={1} max={120} value={form.timeoutMinutes} onChange={event => setForm(current => current ? { ...current, timeoutMinutes: Number(event.target.value) } : current)} />
              </label>
            </div>
            <label className="admin-label">{t('Prompt')}
              <textarea value={form.prompt} onChange={event => setForm(current => current ? { ...current, prompt: event.target.value } : current)} rows={5} maxLength={20000} placeholder={t('Prepara il riepilogo settimanale e invialo su Telegram.')} />
              <small>{t('Il prompt viene eseguito come un messaggio normale, con memoria, progetto e profilo agente selezionati.')}</small>
            </label>
            <div className="admin-grid-2">
              <label className="admin-label">{t('Progetto')}
                <select value={form.projectId} onChange={event => setForm(current => current ? { ...current, projectId: event.target.value } : current)}>
                  <option value="">{t('Nessun progetto')}</option>
                  {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label className="admin-label">{t('Profilo agente')}
                <select value={form.agentProfileId} onChange={event => setForm(current => current ? { ...current, agentProfileId: event.target.value } : current)}>
                  <option value="">{t('Memo (base)')}</option>
                  {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </label>
            </div>
            <div className="admin-grid-2">
              <label className="admin-label">{t('Espressione cron')}
                <input value={form.cron} onChange={event => setForm(current => current ? { ...current, cron: event.target.value } : current)} placeholder="0 9 * * *" spellCheck={false} />
                <small>{t('Campi: minuto ora giorno mese giorno-settimana. Esempio: 0 9 * * 1–5 = feriali alle 09:00.')}</small>
              </label>
              <label className="admin-label">{t('Fuso orario')}
                <input value={form.timezone} onChange={event => setForm(current => current ? { ...current, timezone: event.target.value } : current)} placeholder="Europe/Rome" spellCheck={false} />
              </label>
            </div>
            <div className="automation-presets">
              {CRON_PRESETS.map(preset => (
                <button type="button" key={preset.cron} onClick={() => setForm(current => current ? { ...current, cron: preset.cron } : current)}>{t(preset.label)} <code>{preset.cron}</code></button>
              ))}
            </div>
            <div className="automation-mcp-editor">
              <strong>{t('Server MCP')}</strong>
              <small>{t('Disattivati di default. Le scritture richiedono un’abilitazione esplicita. Gli account vengono risolti dal progetto o dall’account globale.')} {accountsCount > 0 ? `(${accountsCount} ${t('account configurati')})` : ''}</small>
              {MCP_SERVER_DEFINITIONS.map(server => (
                <label className="admin-toggle" key={server.id}>
                  <input
                    type="checkbox"
                    checked={form.mcpEnabled.includes(server.id)}
                    onChange={event => setForm(current => {
                      if (!current) return current;
                      const enabled = event.target.checked ? [...current.mcpEnabled, server.id] : current.mcpEnabled.filter(id => id !== server.id);
                      return { ...current, mcpEnabled: enabled };
                    })}
                  />
                  <span>{server.label}</span>
                </label>
              ))}
              {form.mcpEnabled.length > 0 && (
                <label className="admin-toggle automation-writes-toggle">
                  <input type="checkbox" checked={form.allowWrites} onChange={event => setForm(current => current ? { ...current, allowWrites: event.target.checked } : current)} />
                  <span>{t('Consenti scritture MCP')}</span>
                </label>
              )}
              {form.allowWrites && <div className="admin-inline-warning">{t('Le scritture possono modificare dati reali. Abilita solo se il prompt è progettato per farlo.')}</div>}
            </div>
            <div className="admin-grid-2">
              <label className="admin-toggle">
                <input type="checkbox" checked={form.enabled} onChange={event => setForm(current => current ? { ...current, enabled: event.target.checked } : current)} />
                <span>{t('Automazione attiva')}</span>
              </label>
              <label className="admin-toggle">
                <input type="checkbox" checked={form.notifyTelegram} onChange={event => setForm(current => current ? { ...current, notifyTelegram: event.target.checked } : current)} />
                <span>{t('Invia risultato su Telegram')}</span>
              </label>
              <label className="admin-toggle">
                <input type="checkbox" checked={form.webEnabled} onChange={event => setForm(current => current ? { ...current, webEnabled: event.target.checked } : current)} />
                <span>{t('Abilita ricerca web')}</span>
              </label>
            </div>
            {form.webEnabled && webStatus && !webStatus.configured && <div className="admin-inline-warning">{t('La ricerca web non è configurata. Configurala in Amministrazione → Web prima di eseguire l’automazione.')}</div>}
            {form.notifyTelegram && (
              <label className="admin-label">{t('Account Telegram')}
                <select value={form.telegramAccountId} onChange={event => setForm(current => current ? { ...current, telegramAccountId: event.target.value } : current)}>
                  <option value="">{t('Account predefinito')}{defaultTelegramAccount ? ` · ${defaultTelegramAccount.label}` : ''}</option>
                  {telegramAccounts.filter(account => account.enabled).map(account => <option key={account.id} value={account.id}>{account.label}{account.chatId ? ` · ${account.chatId}` : ''}</option>)}
                </select>
                <small>{t('Gli account Telegram si creano in Amministrazione → Telegram e possono essere usati da più automazioni.')}</small>
              </label>
            )}
            {form.notifyTelegram && telegramAccounts.length === 0 && <div className="admin-inline-warning">{t('Nessun account Telegram configurato. Il risultato resterà nella cronologia, ma non verrà inviato.')}</div>}
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={() => void save()} disabled={saving}>{saving ? t('Salvo…') : t('Salva automazione')}</button>
              <button type="button" onClick={() => { setForm(null); setEditingId(null); }} disabled={saving}>{t('Annulla')}</button>
            </div>
          </div>
        )}
      </section>

      {runsJobId && (
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h3>{t('Cronologia esecuzioni')} · {jobs.find(job => job.id === runsJobId)?.name ?? runsJobId}</h3>
              <p className="admin-card-description">{t('Ogni esecuzione viene salvata anche se il browser è chiuso.')}</p>
            </div>
            <button type="button" onClick={() => void showRuns(runsJobId)} disabled={runsLoading}>{t('Aggiorna')}</button>
          </div>
          {runsLoading && <div className="admin-field-note">{t('Caricamento…')}</div>}
          {!runsLoading && runs.length === 0 && <div className="second-brain-empty">{t('Nessuna esecuzione registrata.')}</div>}
          {!runsLoading && runs.length > 0 && (
            <div className="automation-runs">
              {runs.map(run => (
                <details className="automation-run" key={run.id}>
                  <summary>
                    <span className={`automation-status status-${run.status}`}>{t(runStatusLabel(run.status))}</span>
                    <span>{new Date(run.startedAt).toLocaleString()}</span>
                    <span>{run.trigger === 'manual' ? t('manuale') : t('pianificata')}</span>
                    {run.telegramStatus && <span>Telegram: {run.telegramStatus}{run.telegramDocuments ? ` · ${run.telegramDocuments} file` : ''}</span>}
                    {typeof run.durationMs === 'number' && <span>{Math.round(run.durationMs / 1000)}s</span>}
                  </summary>
                  {run.error && <p className="automation-run-error">{run.error}</p>}
                  {run.output && <pre className="automation-output">{run.output.slice(0, 12_000)}</pre>}
                  {run.telegramError && <p className="automation-run-error">Telegram: {run.telegramError}</p>}
                </details>
              ))}
            </div>
          )}
        </section>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t('Eliminare l’automazione?')}
          confirmLabel={t('Elimina')}
          busy={saving}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>{t('Verranno eliminati anche la cronologia delle esecuzioni e il job pianificato. Le sessioni archiviate restano nella cronologia di Memora.')}</p>
          <p><strong>{deleteTarget.name}</strong></p>
        </ConfirmDialog>
      )}
    </div>
  );
}
