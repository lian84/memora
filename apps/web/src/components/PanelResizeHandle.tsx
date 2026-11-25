import type { PointerEvent as ReactPointerEvent } from 'react';
import { PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH } from '../lib/panel-width';
import { useI18n } from '../i18n';

interface PanelResizeHandleProps {
  width: number;
  onStartResize: (event: ReactPointerEvent<HTMLElement>) => void;
  onResize: (width: number) => void;
}

export function PanelResizeHandle({ width, onStartResize, onResize }: PanelResizeHandleProps) {
  const { t } = useI18n();
  return (
    <div
      className="panel-resize-handle"
      role="separator"
      aria-label={t('Ridimensiona pannello')}
      aria-orientation="vertical"
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      title={t('Trascina per ridimensionare il pannello')}
      onPointerDown={onStartResize}
      onKeyDown={event => {
        const step = event.shiftKey ? 64 : 16;
        if (event.key === 'ArrowLeft') { event.preventDefault(); onResize(width + step); }
        if (event.key === 'ArrowRight') { event.preventDefault(); onResize(width - step); }
        if (event.key === 'Home') { event.preventDefault(); onResize(PANEL_DEFAULT_WIDTH); }
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
