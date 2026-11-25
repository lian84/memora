import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useI18n } from '../i18n';

interface PdfPreviewProps {
  url: string;
  title: string;
  zoom?: number;
}

export function PdfPreview({ url, title, zoom = 1 }: PdfPreviewProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setDocument(null);
    setPage(1);
    setPages(0);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        // pdfjs-dist v6 rimuove `PDFDocumentProxy.destroy()`: il ciclo di vita
        // del documento si chiude distruggendo il loading task.
        const task = pdfjs.getDocument({
          url,
          standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
        });
        const loaded = await task.promise;
        if (cancelled) { void task.destroy(); return; }
        setDocument(loaded);
        setPages(loaded.numPages);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let cancelled = false;
    setLoading(true);
    void document.getPage(page).then(async pdfPage => {
      if (cancelled || !canvasRef.current) return;
      const viewport = pdfPage.getViewport({ scale: 1.35 * zoom });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error(t('Canvas non disponibile'));
      await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
      if (!cancelled) setLoading(false);
    }).catch(err => {
      if (!cancelled) { setError(err instanceof Error ? err.message : String(err)); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [document, page, zoom]);

  return (
    <div className="pdf-preview">
      <div className="pdf-preview-toolbar">
        <span>{title}</span>
        {pages > 1 && (
          <span className="pdf-preview-pages">
            <button type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page <= 1}>‹</button>
            <span>{page} / {pages}</span>
            <button type="button" onClick={() => setPage(value => Math.min(pages, value + 1))} disabled={page >= pages}>›</button>
          </span>
        )}
        <a href={url} target="_blank" rel="noreferrer">{t('Apri')}</a>
      </div>
      {error && <div className="pdf-preview-error">{error}<a href={url} target="_blank" rel="noreferrer">{t('Apri il PDF')}</a></div>}
      {!error && <canvas ref={canvasRef} className="pdf-preview-canvas" style={{ maxWidth: zoom > 1 ? 'none' : '100%' }} aria-label={t('Anteprima {title}', { title })} />}
      {loading && !error && <div className="pdf-preview-loading">{t('Caricamento anteprima PDF…')}</div>}
    </div>
  );
}
