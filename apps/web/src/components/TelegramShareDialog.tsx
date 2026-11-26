import { useEffect, useId, useState } from 'react';
import type { TelegramShareMode, TelegramSharePatch, TelegramShareView } from '@memora/shared';
import { useI18n } from '../i18n';

interface TelegramShareDialogProps {
  view: TelegramShareView | null;
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (patch: TelegramSharePatch) => Promise<void> | void;
}

export function TelegramShareDialog({ view, loading = false, busy = false, error = null, onClose, onSave }: TelegramShareDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const [enabled, setEnabled] = useState(Boolean(view?.share));
  const [targetKey, setTargetKey] = useState('');
  const [mode, setMode] = useState<TelegramShareMode>('answers');
  const [includeArtifacts, setIncludeArtifacts] = useState(true);

  useEffect(() => {
    const share = view?.share;
    setEnabled(Boolean(share));
    setTargetKey(share ? `${share.accountId}:${share.userId}` : view?.targets[0] ? `${view.targets[0].accountId}:${view.targets[0].userId}` : '');
    setMode(share?.mode ?? 'answers');
    setIncludeArtifacts(share?.includeArtifacts !== false);
  }, [view]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const selected = view?.targets.find(target => `${target.accountId}:${target.userId}` === targetKey);
  const canSave = !enabled || Boolean(selected);

  const save = (): void => {
    if (!enabled) {
      void onSave({ enabled: false });
      return;
    }
    if (!selected) return;
    void onSave({
      enabled: true,
      accountId: selected.accountId,
      userId: selected.userId,
      mode,
      includeArtifacts,
    });
  };

  return (
    <div role="presentation" className="dialog-backdrop" onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="delete-dialog telegram-share-dialog" onClick={event => event.stopPropagation()}>
        <h2 id={titleId}>{t('Condivisione Telegram')}</h2>
        <p className="admin-field-note">
          {t('Invia su Telegram le risposte dei turni avviati da questa chat web. Le risposte nate da Telegram non vengono duplicate.')}
        </p>

        {loading && <p className="admin-field-note">{t('Caricamento…')}</p>}
        {!loading && (
          <>
            {!view?.targets.length && (
              <p className="admin-field-note">
                {t('Nessuna chat Telegram collegata. Associa il bot in Amministrazione → Telegram e invia almeno un messaggio, poi riprova.')}
              </p>
            )}

            <label className="admin-toggle">
              <input type="checkbox" checked={enabled} disabled={busy || !view} onChange={event => setEnabled(event.target.checked)} />
              <span>{t('Invia su Telegram')}</span>
            </label>

            {enabled && view?.targets.length ? (
              <>
                <label className="admin-label">{t('Destinazione Telegram')}
                  <select value={targetKey} disabled={busy} onChange={event => setTargetKey(event.target.value)}>
                    {view.targets.map(target => (
                      <option key={`${target.accountId}:${target.userId}`} value={`${target.accountId}:${target.userId}`}>
                        {target.botUsername ? `@${target.botUsername} · ` : ''}{target.userLabel} · {target.accountLabel}
                      </option>
                    ))}
                  </select>
                </label>

                <fieldset className="telegram-share-modes">
                  <legend>{t('Modalità')}</legend>
                  <label>
                    <input type="radio" name="telegram-share-mode" checked={mode === 'answers'} disabled={busy} onChange={() => setMode('answers')} />
                    <span><strong>{t('Solo risposte')}</strong><small>{t('Ricevi su Telegram solo la risposta finale dei turni avviati dalla web UI.')}</small></span>
                  </label>
                  <label>
                    <input type="radio" name="telegram-share-mode" checked={mode === 'full'} disabled={busy} onChange={() => setMode('full')} />
                    <span><strong>{t('Conversazione completa')}</strong><small>{t('Invia anche il testo che scrivi dalla web UI e rende questa la sessione attiva su Telegram. Gli allegati web non vengono copiati.')}</small></span>
                  </label>
                </fieldset>

                <label className="admin-toggle">
                  <input type="checkbox" checked={includeArtifacts} disabled={busy} onChange={event => setIncludeArtifacts(event.target.checked)} />
                  <span>{t('Includi PDF e documenti Office')}</span>
                </label>
              </>
            ) : null}

            {view?.share?.lastError && <p className="admin-field-note" role="alert">{t('Ultimo errore')}: {view.share.lastError}</p>}
            {error && <p role="alert" className="delete-dialog-error">{error}</p>}
          </>
        )}

        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>{t('Annulla')}</button>
          <button type="button" className="delete-confirm-button" onClick={save} disabled={busy || loading || !view || !canSave}>
            {busy ? t('Salvataggio…') : t('Salva')}
          </button>
        </div>
      </div>
    </div>
  );
}
