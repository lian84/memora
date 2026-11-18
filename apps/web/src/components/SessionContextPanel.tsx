import type { SessionContextSettings } from '@memora/shared';
import { useI18n } from '../i18n';

interface SessionContextPanelProps {
  context: SessionContextSettings | null;
  saving?: boolean;
  error?: string | null;
  hasProject?: boolean;
  onChange: (patch: Partial<SessionContextSettings>) => Promise<void> | void;
}

export function SessionContextPanel({ context, saving = false, error = null, hasProject = true, onChange }: SessionContextPanelProps) {
  const { t } = useI18n();
  return (
    <div className="session-context-body">
      <p className="session-context-intro">{t('Scegli cosa può contribuire alla risposta. Le modifiche valgono dal prossimo messaggio e sono salvate in questa chat.')}</p>
      {!context ? (
        <div className="session-context-loading">{t('Caricamento contesto…')}</div>
      ) : (
        <div className="session-context-options">
          <label className="session-context-option">
            <input type="checkbox" checked={context.includeGlobalMemory} disabled={saving} onChange={event => void onChange({ includeGlobalMemory: event.target.checked })} />
            <span>
              <strong>{t('Memoria globale')}</strong>
              <small>{t('Profilo, preferenze e memorie fuori dal progetto.')}</small>
            </span>
          </label>
          {hasProject && (
            <>
              <label className="session-context-option">
                <input type="checkbox" checked={context.includeProjectMemory} disabled={saving} onChange={event => void onChange({ includeProjectMemory: event.target.checked })} />
                <span>
                  <strong>{t('Memoria del progetto')}</strong>
                  <small>{t('Il file memory.md del progetto attivo.')}</small>
                </span>
              </label>
              <label className="session-context-option">
                <input type="checkbox" checked={context.includeProjectSources} disabled={saving} onChange={event => void onChange({ includeProjectSources: event.target.checked })} />
                <span>
                  <strong>{t('Fonti del progetto')}</strong>
                  <small>{t('Documenti e note indicizzati sotto sources/.')}</small>
                </span>
              </label>
            </>
          )}
        </div>
      )}
      {saving && <div className="session-context-status">{t('Salvataggio contesto…')}</div>}
      {error && <div className="session-context-error" role="alert">{error}</div>}
      <div className="session-context-note">{t('Gli allegati del singolo messaggio restano sempre inclusi.')}</div>
    </div>
  );
}
