import { useCallback, useEffect, useState } from 'react';
import type { MonitorSettings, MonitorStatus } from '@memora/shared';
import { checkMonitor, getMonitorStatus, updateMonitorSettings } from '../lib/api';
import { useI18n } from '../i18n';

export function MonitorAdminPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [draft, setDraft] = useState<MonitorSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const apply = useCallback((next: MonitorStatus) => {
    setStatus(next);
    setDraft(current => current ?? next.settings);
  }, []);

  const alertText = (alert: MonitorStatus['alerts'][number]): { title: string; detail: string } => {
    if (alert.key === 'disk_critical' || alert.key === 'disk_warning') {
      const percent = status?.disk.percent;
      return {
        title: t(alert.key === 'disk_critical' ? 'Spazio disco quasi esaurito' : 'Spazio disco in esaurimento'),
        detail: percent === null || percent === undefined
          ? alert.detail
          : t('Utilizzo dati al {percent}%.', { percent: percent.toFixed(1) }),
      };
    }
    if (alert.key === 'backup_missing') {
      return {
        title: t('Nessun backup disponibile'),
        detail: t('Il backup automatico è attivo ma non esiste ancora un archivio.'),
      };
    }
    if (alert.key === 'backup_old') {
      return {
        title: t('Backup locale vecchio'),
        detail: t('L’ultimo backup ha più di {days} giorni.', { days: status?.settings.backupMaxAgeDays ?? 0 }),
      };
    }
    if (alert.key === 'backup_failed') return { title: t('Backup fallito'), detail: alert.detail };
    if (alert.key === 'remote_upload_failed') return { title: t('Upload remoto fallito'), detail: alert.detail };
    if (alert.key.startsWith('automation_')) {
      const name = alert.title.replace(/^[^:]+:\s*/, '');
      return {
        title: t('Automazione fallita: {name}', { name }),
        detail: t(alert.detail.includes('timeout') ? 'L’ultima esecuzione è andata in timeout.' : 'L’ultima esecuzione è fallita.'),
      };
    }
    return { title: alert.title, detail: alert.detail };
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { apply(await getMonitorStatus()); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  const check = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      apply(await checkMonitor());
      setMessage(t('Controllo completato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      apply(await updateMonitorSettings(draft));
      setMessage(t('Impostazioni di monitoraggio salvate.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="monitor-admin">
      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h3>{t('Monitoraggio')}</h3>
            <p className="admin-card-description">{t('Controlla backup, upload remoto, automazioni e spazio disco. Gli avvisi nuovi vengono inviati su Telegram una sola volta.')}</p>
          </div>
          <button type="button" className="admin-primary" onClick={() => void check()} disabled={busy || loading}>{busy ? t('Controllo…') : t('Controlla ora')}</button>
        </div>
        {loading && <div className="admin-field-note">{t('Caricamento…')}</div>}
        {status && (
          <div className="admin-grid-2">
            <div className="backup-stat"><span>{t('Ultimo controllo')}</span><strong>{status.checkedAt ? new Date(status.checkedAt).toLocaleString() : t('Mai')}</strong></div>
            <div className="backup-stat"><span>{t('Spazio disco dati')}</span><strong>{status.disk.percent === null ? t('Non disponibile') : `${status.disk.percent.toFixed(1)}%`}</strong></div>
          </div>
        )}
        {status && status.alerts.length === 0 && <div className="second-brain-empty">{t('Nessun avviso attivo.')}</div>}
        {status && status.alerts.length > 0 && (
          <div className="monitor-alerts">
            {status.alerts.map(alert => {
              const text = alertText(alert);
              return (
                <div className={`monitor-alert is-${alert.severity}`} key={alert.key}>
                  <strong>{text.title}</strong>
                  <span>{text.detail}</span>
                </div>
              );
            })}
          </div>
        )}
        {draft && (
          <div className="monitor-settings">
            <label className="admin-toggle">
              <input type="checkbox" checked={draft.enabled} onChange={event => setDraft(current => current ? { ...current, enabled: event.target.checked } : current)} />
              <span>{t('Monitoraggio attivo')}</span>
            </label>
            <label className="admin-toggle">
              <input type="checkbox" checked={draft.notifyTelegram} onChange={event => setDraft(current => current ? { ...current, notifyTelegram: event.target.checked } : current)} />
              <span>{t('Invia nuovi avvisi su Telegram')}</span>
            </label>
            <div className="admin-grid-2">
              <label className="admin-label">{t('Avviso disco (%)')}
                <input type="number" min={50} max={99} value={draft.diskWarningPercent} onChange={event => setDraft(current => current ? { ...current, diskWarningPercent: Number(event.target.value) } : current)} />
              </label>
              <label className="admin-label">{t('Critico disco (%)')}
                <input type="number" min={51} max={100} value={draft.diskCriticalPercent} onChange={event => setDraft(current => current ? { ...current, diskCriticalPercent: Number(event.target.value) } : current)} />
              </label>
              <label className="admin-label">{t('Backup più vecchio di (giorni)')}
                <input type="number" min={1} max={365} value={draft.backupMaxAgeDays} onChange={event => setDraft(current => current ? { ...current, backupMaxAgeDays: Number(event.target.value) } : current)} />
              </label>
            </div>
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={() => void save()} disabled={busy}>{busy ? t('Salvo…') : t('Salva monitoraggio')}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
