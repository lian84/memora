import { useI18n } from '../i18n';

export const MIN_PREVIEW_ZOOM = 0.5;
export const MAX_PREVIEW_ZOOM = 2.5;
const ZOOM_STEP = 0.1;

export function normalizePreviewZoom(value: number): number {
  return Math.round(Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, value)) * 10) / 10;
}

export function ZoomControls({ zoom, onChange, label }: { zoom: number; onChange: (value: number) => void; label?: string }) {
  const { t } = useI18n();
  const groupLabel = label ?? t('Zoom anteprima');
  return (
    <div className="artifact-zoom" role="group" aria-label={groupLabel}>
      <button type="button" onClick={() => onChange(normalizePreviewZoom(zoom - ZOOM_STEP))} disabled={zoom <= MIN_PREVIEW_ZOOM} aria-label={t('Riduci zoom')}>−</button>
      <button type="button" className="artifact-zoom-value" onClick={() => onChange(1)} title={t('Reimposta zoom al 100%')}>{Math.round(zoom * 100)}%</button>
      <button type="button" onClick={() => onChange(normalizePreviewZoom(zoom + ZOOM_STEP))} disabled={zoom >= MAX_PREVIEW_ZOOM} aria-label={t('Aumenta zoom')}>+</button>
    </div>
  );
}
