import { useCallback, useEffect, useState } from 'react';
import type { UpdateStatus } from '@memora/shared';
import { applyUpdate, checkForUpdate, getUpdateStatus, updateUpdateSettings } from '../lib/api';
import { useI18n } from '../i18n';
import { ConfirmDialog } from './ConfirmDialog';

export function UpdateAdminPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);
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

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      setStatus(await applyUpdate());
      setApplyOpen(false);
      setMessage(t('Aggiornamento richiesto. Memora si riavvierà tra pochi secondi; ricarica la pagina tra un minuto.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setApplyOpen(false);
    } finally {
      setApplying(false);
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
          <div className="admin-actions">
            <button type="button" className="admin-primary" onClick={() => void check()} disabled={checking || loading}>{checking ? t('Controllo…') : t('Controlla ora')}</button>
            {status?.updateAvailable && status.applyAvailable && !status.requestedAt && (
              <button type="button" onClick={() => setApplyOpen(true)} disabled={applying}>{applying ? t('Aggiorno…') : t('Aggiorna ora')}</button>
            )}
          </div>
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
                        <p>{status.applyAvailable
              ? t('Puoi applicare l’aggiornamento da qui con il pulsante Aggiorna ora. Prima dell’aggiornamento viene creato automaticamente un backup cifrato.')
              : t('Scarica la nuova release e usa update.sh. Prima dell’aggiornamento viene creato automaticamente un backup.')}</p>
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

      {applyOpen && (
        <ConfirmDialog
          title={t('Aggiornare Memora?')}
          confirmLabel={t('Aggiorna ora')}
          busyLabel={t('Aggiorno…')}
          busy={applying}
          onClose={() => setApplyOpen(false)}
          onConfirm={() => void apply()}
        >
          <p>{t('Verrà creato automaticamente un backup cifrato prima dell’aggiornamento. Memora si fermerà, applicherà la release e si riavvierà.')}</p>
          <p><strong>{status?.latestVersion}</strong></p>
        </ConfirmDialog>
      )}
    </div>
  );
}
