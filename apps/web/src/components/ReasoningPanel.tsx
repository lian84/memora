import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../i18n';

interface ReasoningPanelProps {
  text: string;
  streaming?: boolean;
}

function lastMeaningfulLine(text: string): string {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

export function ReasoningPanel({ text, streaming = false }: ReasoningPanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const preview = lastMeaningfulLine(text);
  const label = t('Ragionamento');

  useEffect(() => {
    if (!open || !streaming || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [open, streaming, text]);

  if (!text.trim()) return null;

  return (
    <section className={`reasoning-panel${open ? ' is-open' : ''}`} aria-label={label}>
      <button
        type="button"
        className="reasoning-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(value => !value)}
      >
        <span className="reasoning-icon" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a6 6 0 0 0-3.8 10.7c.7.6 1.1 1.4 1.3 2.3l.2 1h4.6l.2-1c.2-.9.6-1.7 1.3-2.3A6 6 0 0 0 12 3Z" />
            <path d="M9.5 20h5M10 17h4" />
          </svg>
        </span>
        <span className="reasoning-label">{label}</span>
        {streaming && <span className="reasoning-live">{t('in corso')}</span>}
        {!open && preview && <span className="reasoning-preview">{preview}</span>}
        <svg className={`reasoning-chevron${open ? ' is-open' : ''}`} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="reasoning-body" id={bodyId} ref={bodyRef} tabIndex={0}>
          <pre>{text}</pre>
        </div>
      )}
    </section>
  );
}
