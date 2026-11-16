import { useEffect, useId } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';

interface ConfirmDialogProps {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  error?: string | null;
  confirmDisabled?: boolean;
  cancelAutoFocus?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel = 'Eliminazione…',
  busy = false,
  error = null,
  confirmDisabled = false,
  cancelAutoFocus = true,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  return (
    <div role="presentation" className="dialog-backdrop" onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="delete-dialog" onClick={event => event.stopPropagation()}>
        <h2 id={titleId}>{title}</h2>
        {children}
        {error && <p role="alert" className="delete-dialog-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" autoFocus={cancelAutoFocus} onClick={onClose} disabled={busy}>{t('Annulla')}</button>
          <button type="button" className="delete-confirm-button" onClick={onConfirm} disabled={busy || confirmDisabled}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
