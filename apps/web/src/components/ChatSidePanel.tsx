import { useMemo } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { PanelResizeHandle } from './PanelResizeHandle';
import { PANEL_DEFAULT_WIDTH, PANEL_EXPANDED_WIDTH, usePanelWidth } from '../lib/panel-width';
import { useI18n } from '../i18n';

export type ChatSidePanelTab = 'files' | 'context' | 'artifacts' | 'web' | 'mcp';

interface ChatSidePanelProps {
  title: string;
  eyebrow: string;
  ariaLabel: string;
  hasFiles: boolean;
  activeTab: ChatSidePanelTab;
  onTabChange: (tab: ChatSidePanelTab) => void;
  artifactsCount?: number;
  webSourcesCount?: number;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onClose?: () => void;
  children: ReactNode;
}

interface TabDefinition {
  id: ChatSidePanelTab;
  label: string;
  count?: number;
}

export function ChatSidePanel({
  title,
  eyebrow,
  ariaLabel,
  hasFiles,
  activeTab,
  onTabChange,
  artifactsCount = 0,
  webSourcesCount = 0,
  expanded = false,
  onToggleExpanded,
  onClose,
  children,
}: ChatSidePanelProps) {
  const { t } = useI18n();
  const { width, setWidth, startResize } = usePanelWidth();

  const tabs = useMemo<TabDefinition[]>(
    () => [
      ...(hasFiles ? [{ id: 'files' as const, label: t('File') }] : []),
      { id: 'context', label: t('Contesto') },
      { id: 'artifacts', label: t('Artefatti'), count: artifactsCount },
      { id: 'web', label: t('Fonti'), count: webSourcesCount },
      { id: 'mcp', label: t('MCP') },
    ],
    [artifactsCount, hasFiles, t, webSourcesCount]
  );

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    onTabChange(tabs[nextIndex]!.id);
    const tabList = event.currentTarget.parentElement;
    tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  };

  return (
    <aside
      className={`project-files-panel chat-side-panel${expanded ? ' is-expanded' : ''}`}
      style={{ width: `${width}px`, flexBasis: `${width}px` }}
      aria-label={ariaLabel}
    >
      <PanelResizeHandle width={width} onStartResize={startResize} onResize={setWidth} />
      <header className="project-files-header">
        <div>
          <span className="project-files-eyebrow">{eyebrow}</span>
          <h2 title={title}>{title}</h2>
        </div>
        <div className="project-files-header-actions">
          {onToggleExpanded && (
            <button
              type="button"
              className="project-files-icon"
              onClick={() => {
                setWidth(expanded ? PANEL_DEFAULT_WIDTH : PANEL_EXPANDED_WIDTH);
                onToggleExpanded();
              }}
              title={t(expanded ? 'Riduci pannello' : 'Espandi pannello')}
              aria-label={t(expanded ? 'Riduci pannello' : 'Espandi pannello')}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
              </svg>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="project-files-icon"
              onClick={onClose}
              title={t('Comprimi pannello')}
              aria-label={t('Comprimi pannello')}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <nav className="project-files-tabs" role="tablist" aria-label={t('Aree del pannello')}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`chat-panel-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls="chat-panel-content"
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={activeTab === tab.id ? 'is-active' : ''}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className="panel-tab-count"
                aria-label={t('{count} elementi', { count: tab.count })}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div
        className="chat-side-panel-body"
        id="chat-panel-content"
        role="tabpanel"
        aria-labelledby={`chat-panel-tab-${activeTab}`}
      >
        {children}
      </div>
    </aside>
  );
}
