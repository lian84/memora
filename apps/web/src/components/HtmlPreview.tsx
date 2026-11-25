import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ZoomControls } from './ZoomControls';
import { useI18n } from '../i18n';

type HtmlViewport = 'auto' | 'desktop' | 'tablet' | 'mobile';

interface HtmlPreviewProps {
  title: string;
  html?: string;
  url?: string;
  openUrl?: string;
}

const VIEWPORTS: Array<{ id: HtmlViewport; label: string; width: number | null }> = [
  { id: 'auto', label: 'Auto', width: null },
  { id: 'desktop', label: 'Desktop', width: 1280 },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'mobile', label: 'Mobile', width: 390 },
];

const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;";

function addPreviewMetadata(html: string): string {
  const metadata = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${metadata}`);
  }
  return `${metadata}${html}`;
}

function RefreshIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.3-5.7" /><path d="M20 4v7h-7" /></svg>;
}

function ExternalIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 13v6H5V6h6" /></svg>;
}

export function HtmlPreview({ title, html, url, openUrl }: HtmlPreviewProps) {
  const { t } = useI18n();
  const [viewport, setViewport] = useState<HtmlViewport>('auto');
  const [zoom, setZoom] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const source = useMemo(() => html ? addPreviewMetadata(html) : undefined, [html]);

  useEffect(() => {
    setZoom(1);
    setViewport('auto');
  }, [html, url]);

  const width = VIEWPORTS.find(item => item.id === viewport)?.width ?? null;
  const canvasStyle: CSSProperties = {
    height: '100%',
    ...(width ? { width: `${width}px` } : { width: '100%' }),
    ...(zoom !== 1 ? { zoom } : {}),
  } as CSSProperties;
  const frameSrc = url ? `${url}${url.includes('?') ? '&' : '?'}preview_refresh=${refresh}` : undefined;
  const fileUrl = openUrl ?? url;

  return (
    <div className="html-preview">
      <div className="html-preview-toolbar">
        <div className="html-preview-viewports" role="group" aria-label={t('Larghezza anteprima')}>
          {VIEWPORTS.map(item => (
            <button
              type="button"
              key={item.id}
              className={viewport === item.id ? 'is-active' : ''}
              aria-pressed={viewport === item.id}
              onClick={() => setViewport(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="html-preview-actions">
          <ZoomControls zoom={zoom} onChange={setZoom} />
          <button type="button" className="html-preview-icon" onClick={() => setRefresh(value => value + 1)} title={t('Ricarica anteprima')} aria-label={t('Ricarica anteprima')}><RefreshIcon /></button>
          {fileUrl && <a className="html-preview-icon" href={fileUrl} target="_blank" rel="noreferrer" title={t('Apri file originale')} aria-label={t('Apri file originale')}><ExternalIcon /></a>}
        </div>
      </div>
      <div className="html-preview-scroll">
        {source ? (
          <div className="html-preview-canvas" style={canvasStyle}>
            <iframe className="html-preview-frame" title={t('Anteprima {title}', { title })} sandbox="" srcDoc={source} />
          </div>
        ) : url ? (
          <div className="html-preview-canvas" style={canvasStyle}>
            <iframe className="html-preview-frame" title={t('Anteprima {title}', { title })} sandbox="" src={frameSrc} />
          </div>
        ) : (
          <div className="project-file-preview-empty">{t('Anteprima HTML non disponibile.')}</div>
        )}
      </div>
    </div>
  );
}
