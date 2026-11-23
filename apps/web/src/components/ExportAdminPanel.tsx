import { useCallback, useEffect, useState } from 'react';
import type { DataExportRecord, DataExportStatus } from '@memora/shared';
import { createDataExport, dataExportDownloadUrl, deleteDataExport, getDataExportStatus } from '../lib/api';
import { useI18n } from '../i18n';
import { ConfirmDialog } from './ConfirmDialog';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExportAdminPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState<DataExportStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DataExportRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setStatus(await getDataExportStatus()); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      await createDataExport();
      await load();
      setMessage(t('Esportazione creata.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setCreating(false); }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setCreating(true);
    setError(null);
    try {
      await deleteDataExport(deleteTarget.id);
      setDeleteTarget(null);
      await load();
      setMessage(t('Esportazione eliminata.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setCreating(false); }
  };

  return (
    <div className="export-admin">
      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h3>{t('Esportazione dati')}</h3>
            <p className="admin-card-description">{t('Crea un archivio leggibile con memoria, progetti, chat, agenti, automazioni, artefatti e allegati. Non contiene configurazione, credenziali o segreti. L’archivio contiene dati personali: conservalo in un luogo sicuro.')}</p>
          </div>
          <button type="button" className="admin-primary" onClick={() => void create()} disabled={creating || loading}>{creating ? t('Esportazione…') : t('Crea esportazione')}</button>
        </div>
        {loading && <div className="admin-field-note">{t('Caricamento…')}</div>}
        {status && status.exports.length === 0 && <div className="second-brain-empty">{t('Nessuna esportazione.')}</div>}
        {status && status.exports.length > 0 && (
          <div className="backup-list">
            {status.exports.map(record => (
              <div className="backup-row" key={record.id}>
                <div className="backup-row-main">
                  <strong>{new Date(record.createdAt).toLocaleString()}</strong>
                  <span>{formatSize(record.size)} · {record.filename}</span>
                </div>
                <div className="backup-row-actions">
                  <a className="backup-download" href={dataExportDownloadUrl(record.id)}>{t('Scarica')}</a>
                  <button type="button" onClick={() => setDeleteTarget(record)}>{t('Elimina')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="admin-field-note">{t('Per importare un export usa una data directory vuota: vedi docs/INSTALL.md e scripts/import-export.mjs. Le impostazioni e i segreti non vengono esportati.')}</p>
      </section>

      {deleteTarget && (
        <ConfirmDialog
          title={t('Eliminare l’esportazione?')}
          confirmLabel={t('Elimina')}
          busy={creating}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void remove()}
        >
          <p>{t('L’archivio esportato verrà eliminato dalla cartella locale.')}</p>
          <p><strong>{deleteTarget.filename}</strong></p>
        </ConfirmDialog>
      )}
    </div>
  );
}
