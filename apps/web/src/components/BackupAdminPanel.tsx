import { useCallback, useEffect, useState } from 'react';
import type { BackupRecord, BackupRemoteStatus, BackupSchedule, BackupStatus } from '@memora/shared';
import {
  backupDownloadUrl,
  configureBackupRemote,
  createBackup,
  disconnectBackupRemote,
  getBackupRemoteStatus,
  setBackupRemoteAutoUpload,
  uploadLatestBackup,
  deleteBackup,
  getBackupStatus,
  setBackupPassword,
  updateBackupSchedule,
} from '../lib/api';
import { useI18n } from '../i18n';
import { ConfirmDialog } from './ConfirmDialog';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const DAYS = [
  { value: 1, label: 'Lunedì' },
  { value: 2, label: 'Martedì' },
  { value: 3, label: 'Mercoledì' },
  { value: 4, label: 'Giovedì' },
  { value: 5, label: 'Venerdì' },
  { value: 6, label: 'Sabato' },
  { value: 0, label: 'Domenica' },
] as const;

export function BackupAdminPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupRecord | null>(null);
  const [remote, setRemote] = useState<BackupRemoteStatus | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteDisconnect, setRemoteDisconnect] = useState(false);
  const [remoteForm, setRemoteForm] = useState({ remoteName: 'memora-mega', email: '', password: '', twoFactor: '', folder: 'memora-backups', autoUpload: true });

  const applyStatus = useCallback((next: BackupStatus) => {
    setStatus(next);
    setSchedule(current => current ?? next.schedule);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextRemote] = await Promise.all([getBackupStatus(), getBackupRemoteStatus().catch(() => null)]);
      applyStatus(nextStatus);
      setRemote(nextRemote);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [applyStatus]);

  useEffect(() => { void load(); }, [load]);

  const savePassword = async () => {
    if (password.length < 12) { setError(t('La password del backup deve avere almeno 12 caratteri.')); return; }
    if (password !== passwordConfirm) { setError(t('Le password del backup non coincidono.')); return; }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      applyStatus(await setBackupPassword(password));
      setPassword('');
      setPasswordConfirm('');
      setMessage(t('Password del backup salvata. Conservala: serve per ripristinare i backup.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const runBackup = async () => {
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      await createBackup();
      const [nextStatus, nextRemote] = await Promise.all([getBackupStatus(), getBackupRemoteStatus().catch(() => null)]);
      applyStatus(nextStatus);
      setRemote(nextRemote);
      setMessage(t('Backup completato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await load();
    } finally {
      setCreating(false);
    }
  };

  const saveSchedule = async () => {
    if (!schedule) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      applyStatus(await updateBackupSchedule(schedule));
      setMessage(t('Pianificazione del backup salvata.'));
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
      await deleteBackup(deleteTarget.id);
      setDeleteTarget(null);
      await load();
      setMessage(t('Backup eliminato.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveRemote = async () => {
    if (!remoteForm.email.trim() || !remoteForm.password) { setError(t('Inserisci email e password Mega.')); return; }
    setRemoteBusy(true);
    setError(null);
    setMessage(null);
    try {
      setRemote(await configureBackupRemote({
        remoteName: remoteForm.remoteName.trim(),
        email: remoteForm.email.trim(),
        password: remoteForm.password,
        ...(remoteForm.twoFactor.trim() ? { twoFactor: remoteForm.twoFactor.trim() } : {}),
        folder: remoteForm.folder.trim(),
        autoUpload: remoteForm.autoUpload,
      }));
      setRemoteForm(current => ({ ...current, password: '', twoFactor: '' }));
      setMessage(t('Backup remoto configurato e connessione verificata.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoteBusy(false);
    }
  };

  const uploadRemote = async () => {
    setRemoteBusy(true);
    setError(null);
    setMessage(null);
    try {
      setRemote(await uploadLatestBackup());
      setMessage(t('Ultimo backup caricato sul remoto.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoteBusy(false);
    }
  };

  const toggleRemoteAuto = async (enabled: boolean) => {
    setRemoteBusy(true);
    setError(null);
    try {
      setRemote(await setBackupRemoteAutoUpload(enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoteBusy(false);
    }
  };

  const disconnectRemote = async () => {
    setRemoteBusy(true);
    setError(null);
    try {
      setRemote(await disconnectBackupRemote());
      setRemoteDisconnect(false);
      setMessage(t('Backup remoto disconnesso.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoteBusy(false);
    }
  };

  return (
    <div className="backup-admin">
      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}
      {status?.maintenance && <div className="admin-alert is-warning">{t('Manutenzione in corso: backup in esecuzione. Le altre funzioni sono temporaneamente bloccate.')}</div>}

      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h3>{t('Backup locale')}</h3>
            <p className="admin-card-description">{t('Crea un archivio cifrato della memoria, delle chat, dei progetti e della configurazione. La password non viene restituita dall’API; l’archivio contiene la configurazione cifrata, quindi serve la password per ripristinarlo.')}</p>
          </div>
          <button type="button" className="admin-primary" onClick={() => void runBackup()} disabled={creating || !status?.passwordConfigured || status?.busy}>
            {creating ? t('Backup in corso…') : t('Crea backup ora')}
          </button>
        </div>
        {loading && <div className="admin-field-note">{t('Caricamento…')}</div>}
        {status && (
          <div className="admin-grid-2">
            <div className="backup-stat"><span>{t('Cartella locale')}</span><code>{status.localDir}</code></div>
            <div className="backup-stat"><span>{t('Password')}</span><strong>{status.passwordConfigured ? t('Configurata') : t('Da configurare')}</strong></div>
            <div className="backup-stat"><span>{t('Ultimo backup')}</span><strong>{status.lastBackup ? new Date(status.lastBackup.createdAt).toLocaleString() : t('Nessuno')}</strong></div>
            <div className="backup-stat"><span>{t('Prossimo automatico')}</span><strong>{status.nextRunAt ? new Date(status.nextRunAt).toLocaleString() : t('Disattivato')}</strong></div>
          </div>
        )}
        {status && !status.passwordConfigured && <div className="admin-inline-warning">{t('Configura la password del backup prima di creare un archivio.')}</div>}
        {status && status.backups.length > 0 && (
          <div className="backup-list">
            {status.backups.map(record => (
              <div className="backup-row" key={record.id}>
                <div className="backup-row-main">
                  <strong>{new Date(record.createdAt).toLocaleString()}</strong>
                  <span>{record.trigger === 'automatic' ? t('Automatico') : t('Manuale')} · {formatSize(record.size)} · {t('cifrato')}</span>
                </div>
                <div className="backup-row-actions">
                  <a className="backup-download" href={backupDownloadUrl(record.id)}>{t('Scarica')}</a>
                  <button type="button" onClick={() => setDeleteTarget(record)}>{t('Elimina')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="admin-card">
        <h3>{t('Password del backup')}</h3>
        <p className="admin-card-description">{t('La password cifra i backup. Non viene restituita dall’API e non può essere recuperata: senza password i backup non sono ripristinabili. Se la cambi, i backup precedenti richiedono la password vecchia.')}</p>
        <div className="admin-grid-2">
          <label className="admin-label">{t('Nuova password')}
            <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" />
          </label>
          <label className="admin-label">{t('Conferma password')}
            <input type="password" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} autoComplete="new-password" />
          </label>
        </div>
        <div className="admin-actions">
          <button type="button" className="admin-primary" onClick={() => void savePassword()} disabled={saving}>{saving ? t('Salvo…') : t('Salva password')}</button>
        </div>
      </section>

      <section className="admin-card">
        <h3>{t('Backup automatico')}</h3>
        <p className="admin-card-description">{t('Il backup automatico mette Memora in manutenzione, attende la fine delle attività e crea un archivio cifrato. Le copie più vecchie vengono eliminate secondo la retention.')}</p>
        {schedule && (
          <div className="backup-schedule">
            <label className="admin-toggle">
              <input type="checkbox" checked={schedule.enabled} onChange={event => setSchedule(current => current ? { ...current, enabled: event.target.checked } : current)} />
              <span>{t('Attiva backup automatico')}</span>
            </label>
            <div className="admin-grid-2">
              <label className="admin-label">{t('Frequenza')}
                <select value={schedule.frequency} onChange={event => setSchedule(current => current ? { ...current, frequency: event.target.value as BackupSchedule['frequency'] } : current)}>
                  <option value="weekly">{t('Settimanale')}</option>
                  <option value="daily">{t('Giornaliero')}</option>
                </select>
              </label>
              <label className="admin-label">{t('Orario')}
                <input type="time" value={schedule.time} onChange={event => setSchedule(current => current ? { ...current, time: event.target.value } : current)} />
              </label>
              {schedule.frequency === 'weekly' && (
                <label className="admin-label">{t('Giorno')}
                  <select value={schedule.weekday} onChange={event => setSchedule(current => current ? { ...current, weekday: Number(event.target.value) } : current)}>
                    {DAYS.map(day => <option key={day.value} value={day.value}>{t(day.label)}</option>)}
                  </select>
                </label>
              )}
              <label className="admin-label">{t('Copie da conservare')}
                <input type="number" min={1} max={20} value={schedule.retention} onChange={event => setSchedule(current => current ? { ...current, retention: Number(event.target.value) } : current)} />
                <small>{t('Default: 4 copie.')}</small>
              </label>
              <label className="admin-label">{t('Fuso orario')}
                <input value={schedule.timezone} onChange={event => setSchedule(current => current ? { ...current, timezone: event.target.value } : current)} />
              </label>
            </div>
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={() => void saveSchedule()} disabled={saving}>{saving ? t('Salvo…') : t('Salva pianificazione')}</button>
            </div>
          </div>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h3>{t('Backup remoto')}</h3>
            <p className="admin-card-description">{t('Collega Mega tramite rclone. Sul remoto viene mantenuta solo la copia più recente; l’archivio è già cifrato localmente.')}</p>
          </div>
          {remote?.configured && <span className="automation-pill is-ok">{t('Connesso')}</span>}
        </div>
        {remote && !remote.rcloneAvailable && <div className="admin-inline-warning">{t('rclone non è installato sul server. Installalo con il pacchetto Debian rclone e ricarica la pagina.')}</div>}
        {!remote?.configured ? (
          <div className="backup-remote-form">
            <div className="admin-grid-2">
              <label className="admin-label">{t('Nome remote')}
                <input value={remoteForm.remoteName} onChange={event => setRemoteForm(current => ({ ...current, remoteName: event.target.value }))} spellCheck={false} />
              </label>
              <label className="admin-label">{t('Cartella remota')}
                <input value={remoteForm.folder} onChange={event => setRemoteForm(current => ({ ...current, folder: event.target.value }))} placeholder="memora-backups" spellCheck={false} />
              </label>
            </div>
            <div className="admin-grid-2">
              <label className="admin-label">{t('Email Mega')}
                <input type="email" value={remoteForm.email} onChange={event => setRemoteForm(current => ({ ...current, email: event.target.value }))} autoComplete="username" spellCheck={false} />
              </label>
              <label className="admin-label">{t('Password Mega')}
                <input type="password" value={remoteForm.password} onChange={event => setRemoteForm(current => ({ ...current, password: event.target.value }))} autoComplete="current-password" />
              </label>
            </div>
            <div className="admin-grid-2">
              <label className="admin-label">{t('Codice 2FA (opzionale)')}
                <input value={remoteForm.twoFactor} onChange={event => setRemoteForm(current => ({ ...current, twoFactor: event.target.value }))} inputMode="numeric" autoComplete="one-time-code" />
              </label>
              <label className="admin-toggle">
                <input type="checkbox" checked={remoteForm.autoUpload} onChange={event => setRemoteForm(current => ({ ...current, autoUpload: event.target.checked }))} />
                <span>{t('Carica automaticamente dopo ogni backup')}</span>
              </label>
            </div>
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={() => void saveRemote()} disabled={remoteBusy || remote?.rcloneAvailable === false}>{remoteBusy ? t('Connessione…') : t('Connetti Mega e verifica')}</button>
            </div>
          </div>
        ) : (
          <div className="backup-remote-configured">
            <div className="admin-grid-2">
              <div className="backup-stat"><span>{t('Remote')}</span><strong>{remote.remoteName}:{remote.folder}</strong></div>
              <div className="backup-stat"><span>{t('Ultimo upload')}</span><strong>{remote.lastUploadAt ? new Date(remote.lastUploadAt).toLocaleString() : t('Nessuno')}</strong></div>
            </div>
            {remote.lastUploadName && <div className="admin-field-note">{t('File remoto')}: {remote.lastUploadName}</div>}
            {remote.lastError && <div className="admin-inline-warning">{remote.lastError}</div>}
            <label className="admin-toggle">
              <input type="checkbox" checked={remote.autoUpload} disabled={remoteBusy} onChange={event => void toggleRemoteAuto(event.target.checked)} />
              <span>{t('Carica automaticamente dopo ogni backup')}</span>
            </label>
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={() => void uploadRemote()} disabled={remoteBusy || status?.busy || !remote?.rcloneAvailable}>{remoteBusy ? t('Caricamento…') : t('Carica ultimo backup')}</button>
              <button type="button" onClick={() => setRemoteDisconnect(true)} disabled={remoteBusy}>{t('Disconnetti')}</button>
            </div>
          </div>
        )}
      </section>

      {remoteDisconnect && (
        <ConfirmDialog
          title={t('Disconnettere il backup remoto?')}
          confirmLabel={t('Disconnetti')}
          busy={remoteBusy}
          onClose={() => setRemoteDisconnect(false)}
          onConfirm={() => void disconnectRemote()}
        >
          <p>{t('Le credenziali rclone locali verranno rimosse. I file già presenti su Mega non verranno cancellati.')}</p>
        </ConfirmDialog>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t('Eliminare il backup?')}
          confirmLabel={t('Elimina')}
          busy={saving}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>{t('L’archivio cifrato verrà eliminato dalla cartella locale. L’operazione non può essere annullata.')}</p>
          <p><strong>{deleteTarget.archiveName}</strong></p>
        </ConfirmDialog>
      )}
    </div>
  );
}
