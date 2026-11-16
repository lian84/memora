import { useEffect, useState } from 'react';
import type { SpreadsheetPreview as SpreadsheetPreviewData } from '@memora/shared';
import { getArtifactSpreadsheetPreview } from '../lib/api';
import { SpreadsheetView } from './SpreadsheetView';

interface SpreadsheetPreviewProps {
  sessionId: string;
  artifactId: string;
  version?: number;
  title: string;
}

export function SpreadsheetPreview({ sessionId, artifactId, version, title }: SpreadsheetPreviewProps) {
  const [data, setData] = useState<SpreadsheetPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    void getArtifactSpreadsheetPreview(sessionId, artifactId, version)
      .then(result => { if (!cancelled) setData(result); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, artifactId, version]);

  if (loading) return <div className="project-file-preview-empty">Caricamento foglio Excel…</div>;
  if (error) return <div className="project-file-preview-error">{error}</div>;
  if (!data) return <div className="project-file-preview-empty">Nessun foglio disponibile.</div>;
  return <SpreadsheetView data={data} title={title} />;
}
