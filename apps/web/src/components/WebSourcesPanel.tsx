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
      {sources.length > 0 && (
        <div className="web-sources-legend" aria-label={t('Legenda delle fonti')}>
          <span><span className="web-source-kind is-search">{t('Ricerca')}</span> {t('trovata nella ricerca, non ancora letta')}</span>
          <span><span className="web-source-kind is-page">{t('Letta')}</span> {t('pagina letta e usata nella risposta')}</span>
        </div>
      )}
      <div className="web-sources-list">
        {sources.map((source, index) => {
          const number = source.number ?? index + 1;
          const kindLabel = source.kind === 'pdf' ? 'PDF' : source.kind === 'search' ? t('Ricerca') : t('Letta');
          const kindTitle = source.kind === 'pdf'
            ? t('PDF letto da Memo: il testo è stato estratto e usato nella risposta.')
            : source.kind === 'search'
              ? t('Risultato di ricerca: titolo e descrizione dal motore, pagina non ancora letta.')
              : t('Pagina letta da Memo: il contenuto è stato estratto e usato nella risposta.');
          return (
          <article className="web-source" key={source.id}>
            <div className="web-source-head">
              <span className="web-source-number" aria-label={t('Fonte {number}', { number })}>[{number}]</span>
              <span className={`web-source-kind is-${source.kind}`} title={kindTitle}>{kindLabel}</span>
              <span className="web-source-domain">{source.domain}</span>
            </div>
            <a href={source.url} target="_blank" rel="noreferrer" className="web-source-title">{source.title || source.url}</a>
            {source.snippet && <p>{source.snippet}</p>}
            {source.error && <p className="web-source-error">{source.error}</p>}
          </article>
          );
        })}
      </div>
    </div>
  );
}
