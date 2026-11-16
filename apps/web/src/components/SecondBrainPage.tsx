import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectRecord } from '@memora/shared';
import { getMemorySource, getMemorySourceHistory, listSources } from '../lib/api';
import type { MemoryHistoryRecord, MemorySource, MemorySourceDetail } from '../lib/api';
import { MemorySourceDetail as MemorySourceDetailView } from './MemorySourceDetail';

interface SecondBrainPageProps {
  projects: ProjectRecord[];
  refreshKey?: number;
  initialScope?: string;
  onClose?: () => void;
}

export function SecondBrainPage({ projects, refreshKey = 0, initialScope = 'all', onClose }: SecondBrainPageProps) {
  const [sources, setSources] = useState<MemorySource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string>(initialScope);
  const [selectedSource, setSelectedSource] = useState<MemorySourceDetail | null>(null);
  const [sourceHistory, setSourceHistory] = useState<MemoryHistoryRecord[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.name])), [projects]);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSources(await listSources());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSources(); }, [loadSources, refreshKey]);

  const visibleSources = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('it-IT');
    return sources
      .filter(source => {
        if (scope === 'global') return !source.projectId;
        if (scope !== 'all') return source.projectId === scope;
        return true;
      })
      .filter(source => !normalized || `${source.relativePath} ${source.title ?? ''} ${source.category}`.toLocaleLowerCase('it-IT').includes(normalized))
      .sort((a, b) => (a.projectId ?? '').localeCompare(b.projectId ?? '', 'it') || a.relativePath.localeCompare(b.relativePath, 'it'));
  }, [sources, query, scope]);

  const openSource = useCallback(async (source: MemorySource) => {
    setSourceLoading(true);
    setSourceError(null);
    setSourceHistory([]);
    try {
      const [detail, history] = await Promise.all([
        getMemorySource(source.id),
        getMemorySourceHistory(source.id).catch(() => []),
      ]);
      setSelectedSource(detail);
      setSourceHistory(history);
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : String(err));
    } finally {
      setSourceLoading(false);
    }
  }, []);

  const closeSource = useCallback(() => {
    setSelectedSource(null);
    setSourceHistory([]);
    setSourceError(null);
  }, []);

  const handleSaved = useCallback(async (source: MemorySourceDetail) => {
    setSelectedSource(source);
    try { setSourceHistory(await getMemorySourceHistory(source.id)); } catch { setSourceHistory([]); }
    await loadSources();
  }, [loadSources]);

  const handleDeleted = useCallback(async () => {
    closeSource();
    await loadSources();
  }, [closeSource, loadSources]);

  const scopeLabel = (source: MemorySource) => source.projectId ? projectNames.get(source.projectId) ?? source.projectId : 'Globale';

  return (
    <section className="second-brain-page" aria-label="Second Brain">
      <header className="second-brain-page-header">
        <div>
          <span className="admin-eyebrow">Memoria personale</span>
          <h2>Second Brain</h2>
          <p>Tutte le memorie e le fonti indicizzate, globali e di progetto. Puoi modificare il Markdown direttamente da qui.</p>
        </div>
        {onClose && <button type="button" className="admin-close" onClick={onClose}>Torna alla chat</button>}
      </header>

      {error && <div className="admin-alert is-error" role="alert">{error}</div>}

      {selectedSource ? (
        <div className="second-brain-page-detail">
          {sourceLoading && <div className="project-files-empty">Caricamento fonte…</div>}
          {sourceError && <div className="memory-inbox-error" role="alert">{sourceError}</div>}
          <MemorySourceDetailView
            source={selectedSource}
            history={sourceHistory}
            onBack={closeSource}
            onSaved={(source) => void handleSaved(source)}
            onDeleted={() => void handleDeleted()}
          />
        </div>
      ) : (
        <>
          <div className="second-brain-page-toolbar">
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Cerca per file, titolo o categoria…"
              aria-label="Cerca nella memoria"
            />
            <select value={scope} onChange={event => setScope(event.target.value)} aria-label="Filtro memoria">
              <option value="all">Tutte le memorie</option>
              <option value="global">Solo globale</option>
              {projects.map(project => <option key={project.id} value={project.id}>Progetto: {project.name}</option>)}
            </select>
            <button type="button" onClick={() => void loadSources()} disabled={loading}>{loading ? 'Aggiorno…' : 'Aggiorna'}</button>
          </div>

          <div className="second-brain-page-list">
            {loading && sources.length === 0 && <div className="second-brain-empty">Caricamento memorie…</div>}
            {!loading && visibleSources.length === 0 && <div className="second-brain-empty">Nessuna memoria corrispondente.</div>}
            {visibleSources.map(source => (
              <button type="button" className="second-brain-page-source" key={source.id} onClick={() => void openSource(source)}>
                <span className={`project-file-badge is-${source.category === 'projects' ? 'markdown' : 'text'}`}>{source.category === 'projects' ? 'PR' : 'MD'}</span>
                <span className="second-brain-page-source-main">
                  <strong>{source.title ?? source.relativePath}</strong>
                  <small>{scopeLabel(source)} · {source.relativePath}</small>
                </span>
                <span className="second-brain-page-source-meta">{source.chunkCount} chunk · {new Date(source.modifiedAt).toLocaleDateString('it-IT')}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
