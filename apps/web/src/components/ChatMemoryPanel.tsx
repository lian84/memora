import { useCallback, useEffect, useState } from 'react';
import type { MemorySource } from '../lib/api';
import { listSources } from '../lib/api';
import { MemoryInbox } from './MemoryInbox';
import { useI18n } from '../i18n';

interface ChatMemoryPanelProps {
  refreshKey?: number;
  projectId?: string | null;
  projectName?: string;
  onOpenSecondBrain?: (scope?: string) => void;
}

export function ChatMemoryPanel({ refreshKey = 0, projectId = null, projectName, onOpenSecondBrain }: ChatMemoryPanelProps) {
  const { t } = useI18n();
  const [sources, setSources] = useState<MemorySource[]>([]);
  const [inboxCount, setInboxCount] = useState(0);

  const loadSources = useCallback(async () => {
    try { setSources(await listSources()); } catch { setSources([]); }
  }, []);

  useEffect(() => { void loadSources(); }, [loadSources, refreshKey]);

  const globalCount = sources.filter(source => !source.projectId).length;
  const projectCount = projectId ? sources.filter(source => source.projectId === projectId).length : 0;

  return (
    <details className="second-brain chat-memory">
      <summary className="second-brain-summary">
        <span className="second-brain-title">{t('Memoria della chat')}</span>
        {inboxCount > 0 && <span className="second-brain-inbox-badge">{t('{count} da rivedere', { count: inboxCount })}</span>}
        <span className="second-brain-status">{projectId ? t('{project} di progetto · {global} globali', { project: projectCount, global: globalCount }) : t('{count} memorie globali', { count: globalCount })}</span>
        <svg className="second-brain-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="second-brain-body">
        <div className="chat-memory-overview">
          <button type="button" onClick={() => onOpenSecondBrain?.('global')}>
            <span>{t('Memoria globale')}</span><strong>{globalCount}</strong>
          </button>
          {projectId && (
            <button type="button" onClick={() => onOpenSecondBrain?.(projectId)}>
              <span>{projectName ?? t('Memoria di progetto')}</span><strong>{projectCount}</strong>
            </button>
          )}
          <button type="button" className="chat-memory-open" onClick={() => onOpenSecondBrain?.()}>
            {t('Apri Second Brain →')}
          </button>
        </div>
        <MemoryInbox refreshKey={refreshKey} onChanged={() => void loadSources()} onCountChange={setInboxCount} />
      </div>
    </details>
  );
}
