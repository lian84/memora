import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
}

interface RowMenuProps {
  label: string;
  items: RowMenuItem[];
}

function MoreIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}

export function RowMenu({ label, items }: RowMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const select = (item: RowMenuItem) => {
    setOpen(false);
    item.onSelect();
  };

  return (
    <div className="row-menu" ref={rootRef}>
      <button
        type="button"
        className="row-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={event => { event.stopPropagation(); setOpen(value => !value); }}
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="row-menu-menu" role="menu" aria-label={label} onClick={event => event.stopPropagation()}>
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`row-menu-item${item.danger ? ' is-danger' : ''}`}
              onClick={() => select(item)}
            >
              {item.icon && <span className="row-menu-item-icon" aria-hidden="true">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
          {items.length === 0 && <div className="row-menu-empty">{t('Nessuna azione')}</div>}
        </div>
      )}
    </div>
  );
}
