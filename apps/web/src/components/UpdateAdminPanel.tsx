import { useCallback, useEffect, useState } from 'react';
import type { UpdateStatus } from '@memora/shared';
import { checkForUpdate, getUpdateStatus, updateUpdateSettings } from '../lib/api';
import { useI18n } from '../i18n';

export function UpdateAdminPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getUpdateStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const check = async () => {
    setChecking(true);
    setError(null);
    setMessage(null);
    try {
      setStatus(await checkForUpdate());
      setMessage(t('Controllo aggiornamenti completato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const saveSettings = async (patch: { enabled?: boolean; notifyTelegram?: boolean }) => {
    setSaving(true);
    setError(null);
    try {
      setStatus(await updateUpdateSettings(patch));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="update-admin">
      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}

      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h3>{t('Aggiornamenti')}</h3>
            <p className="admin-card-description">{t('Il controllo usa le release pubblicate su GitHub, non i singoli push. Non esegue aggiornamenti automatici.')}</p>
          </div>
          <button type="button" className="admin-primary" onClick={() => void check()} disabled={checking || loading}>{checking ? t('Controllo…') : t('Controlla ora')}</button>
        </div>
        {loading && <div className="admin-field-note">{t('Caricamento…')}</div>}
        {status && (
          <div className="admin-grid-2">
            <div className="backup-stat"><span>{t('Versione installata')}</span><strong>{status.currentVersion}</strong></div>
            <div className="backup-stat"><span>{t('Ultima versione')}</span><strong>{status.latestVersion ?? t('Non disponibile')}</strong></div>
            <div className="backup-stat"><span>{t('Repository')}</span><code>{status.repository}</code></div>
            <div className="backup-stat"><span>{t('Ultimo controllo')}</span><strong>{status.checkedAt ? new Date(status.checkedAt).toLocaleString() : t('Mai')}</strong></div>
          </div>
        )}
        {status?.updateAvailable && (
          <div className="admin-alert is-warning">
            <strong>{t('Aggiornamento disponibile: {version}', { version: status.latestVersion ?? '' })}</strong>
            <p>{t('Scarica la nuova release e usa update.sh. Prima dell’aggiornamento viene creato automaticamente un backup.')}</p>
            {status.releaseUrl && <a href={status.releaseUrl} target="_blank" rel="noopener noreferrer">{t('Apri la release')} ↗</a>}
          </div>
        )}
        {status?.error === 'repository_private_or_unavailable' && <div className="admin-field-note">{t('Il repository è privato o non ha ancora release pubbliche. Il controllo inizierà a funzionare quando la repository sarà pubblica.')}</div>}
        {status?.notes && (
          <details className="update-notes">
            <summary>{t('Note della release')}</summary>
            <pre>{status.notes}</pre>
          </details>
        )}
        {status && (
          <div className="update-settings">
            <label className="admin-toggle">
              <input type="checkbox" checked={status.enabled} disabled={saving} onChange={event => void saveSettings({ enabled: event.target.checked })} />
              <span>{t('Controlla automaticamente le release')}</span>
            </label>
            <label className="admin-toggle">
              <input type="checkbox" checked={status.notifyTelegram} disabled={saving} onChange={event => void saveSettings({ notifyTelegram: event.target.checked })} />
              <span>{t('Notifica su Telegram quando esce una nuova versione')}</span>
            </label>
          </div>
        )}
      </section>

      <section className="admin-card">
        <h3>{t('Come aggiornare')}</h3>
        <p className="admin-card-description">{t('L’aggiornamento è manuale. Non avviene automaticamente e non parte a ogni push: solo per una release pubblicata.')}</p>
        <pre className="update-instructions">cd /opt/memora
./update.sh</pre>
        <p className="admin-field-note">{t('update.sh crea un backup, applica la nuova release, esegue le migrazioni e verifica il servizio. Se qualcosa fallisce, tenta il rollback.')}</p>
      </section>
    </div>
  );
}
