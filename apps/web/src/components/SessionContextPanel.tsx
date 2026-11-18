import type { ChatArtifact, SessionContextSettings, WebSource } from '@memora/shared';
import { ArtifactsPanel } from './ArtifactsPanel';
import { PanelResizeHandle } from './PanelResizeHandle';
import { PANEL_DEFAULT_WIDTH, PANEL_EXPANDED_WIDTH, usePanelWidth } from '../lib/panel-width';
import { useI18n } from '../i18n';
import { WebSourcesPanel } from './WebSourcesPanel';

interface SessionContextPanelProps {
  context: SessionContextSettings | null;
  saving?: boolean;
  error?: string | null;
  embedded?: boolean;
  onClose?: () => void;
  onChange: (patch: Partial<SessionContextSettings>) => Promise<void> | void;
  sessionId?: string | null;
  artifacts?: ChatArtifact[];
  artifactsLoading?: boolean;
  artifactsError?: string | null;
  onRefreshArtifacts?: () => void;
  onAttachArtifact?: (artifact: ChatArtifact) => Promise<void> | void;
  onAddArtifactToProject?: (artifact: ChatArtifact) => Promise<{ destination: 'source' | 'file'; relativePath: string; indexed: boolean }>;
  webSources?: WebSource[];
  webSourcesLoading?: boolean;
  webSourcesError?: string | null;
  onRefreshWebSources?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

export function SessionContextPanel({ context, saving = false, error = null, embedded = false, onClose, onChange, sessionId = null, artifacts = [], artifactsLoading = false, artifactsError = null, onRefreshArtifacts, onAttachArtifact, onAddArtifactToProject, webSources = [], webSourcesLoading = false, webSourcesError = null, onRefreshWebSources, expanded = false, onToggleExpanded }: SessionContextPanelProps) {
  const { t } = useI18n();
  const { width: panelWidth, setWidth: setPanelWidth, startResize } = usePanelWidth();
  const body = (
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
        </div>
      )}
      {saving && <div className="session-context-status">{t('Salvataggio contesto…')}</div>}
      {error && <div className="session-context-error" role="alert">{error}</div>}
      <div className="session-context-note">{t('Gli allegati del singolo messaggio restano sempre inclusi.')}</div>
      {!embedded && <div className="session-context-artifacts"><div className="session-context-artifacts-title">{t('Artefatti della chat')}</div><ArtifactsPanel sessionId={sessionId} artifacts={artifacts} loading={artifactsLoading} error={artifactsError} onRefresh={onRefreshArtifacts} onAttachArtifact={onAttachArtifact} onAddArtifactToProject={onAddArtifactToProject} /></div>}
      {!embedded && <div className="session-context-artifacts"><div className="session-context-artifacts-title">{t('Fonti web')}</div><WebSourcesPanel sources={webSources} loading={webSourcesLoading} error={webSourcesError} onRefresh={onRefreshWebSources} /></div>}
    </div>
  );

  if (embedded) return body;

  return (
    <aside className={`project-files-panel session-context-panel${expanded ? ' is-expanded' : ''}`} style={{ width: `${panelWidth}px`, flexBasis: `${panelWidth}px` }} aria-label={t('Contesto della chat')}>
      <PanelResizeHandle width={panelWidth} onStartResize={startResize} onResize={setPanelWidth} />
      <header className="project-files-header">
        <div>
          <span className="project-files-eyebrow">{t('Chat')}</span>
          <h2>{t('Contesto')}</h2>
        </div>
        {onToggleExpanded && (
          <button type="button" className="project-files-icon" onClick={() => { setPanelWidth(expanded ? PANEL_DEFAULT_WIDTH : PANEL_EXPANDED_WIDTH); onToggleExpanded?.(); }} title={t(expanded ? 'Riduci pannello' : 'Espandi pannello')} aria-label={t(expanded ? 'Riduci pannello' : 'Espandi pannello')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /></svg>
          </button>
        )}
        {onClose && (
          <button type="button" className="project-files-icon" onClick={onClose} title={t('Comprimi contesto')} aria-label={t('Comprimi contesto')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        )}
      </header>
      {body}
    </aside>
  );
}
