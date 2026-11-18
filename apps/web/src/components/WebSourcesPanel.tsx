import type { WebSource } from '@memora/shared';
import { useI18n } from '../i18n';

interface WebSourcesPanelProps {
  sources: WebSource[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

export function WebSourcesPanel({ sources, loading = false, error = null, onRefresh }: WebSourcesPanelProps) {
  const { t } = useI18n();
  return (
    <div className="web-sources-panel">
      <div className="web-sources-toolbar">
        <span>{t('{count} fonti web', { count: sources.length })}</span>
        {onRefresh && <button type="button" onClick={onRefresh} disabled={loading}>{loading ? t('Caricamento…') : t('Aggiorna')}</button>}
      </div>
      {error && <div className="project-files-error" role="alert">{error}</div>}
      {!loading && !error && sources.length === 0 && <div className="project-files-empty">{t('Nessuna fonte web. Attiva Web nella chat e fai una ricerca.')}</div>}
      <div className="web-sources-list">
        {sources.map(source => (
          <article className="web-source" key={source.id}>
            <div className="web-source-head">
              <span className={`web-source-kind is-${source.kind}`}>{source.kind === 'pdf' ? 'PDF' : source.kind === 'search' ? 'WEB' : 'HTML'}</span>
              <span className="web-source-domain">{source.domain}</span>
            </div>
            <a href={source.url} target="_blank" rel="noreferrer" className="web-source-title">{source.title || source.url}</a>
            {source.snippet && <p>{source.snippet}</p>}
            {source.error && <p className="web-source-error">{source.error}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}
