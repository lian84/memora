import type { CSSProperties } from 'react';
import type { AgentProfileSummary, SessionAgentInfo } from '@memora/shared';
import { useI18n } from '../i18n';
import { AppIcon } from './AppIcon';

interface AgentProfilePickerProps {
  profiles: AgentProfileSummary[];
  selected: SessionAgentInfo | null;
  saving?: boolean;
  error?: string | null;
  onSelect: (profileId: string | null) => void;
}

export function AgentProfilePicker({ profiles, selected, saving = false, error = null, onSelect }: AgentProfilePickerProps) {
  const { t } = useI18n();
  if (profiles.length === 0) return null;

  return (
    <section className="agent-picker" aria-label={t('Agente per questa chat')}>
      <div className="agent-picker-heading">
        <span>{t('Agente per questa chat')}</span>
        <span className="agent-picker-default">{t('Memo base se non selezioni un profilo')}</span>
      </div>
      <div className="agent-picker-list" role="group" aria-label={t('Scegli un agente')}>
        <button
          type="button"
          className={`agent-chip${selected === null ? ' is-selected' : ''}`}
          aria-pressed={selected === null}
          disabled={saving}
          onClick={() => onSelect(null)}
          title={t('Memo base')}
        >
          <span className="agent-chip-avatar" aria-hidden="true">
            <img src="/brand/memora-avatar.png" alt="" />
          </span>
          <span>{t('Memo base')}</span>
        </button>
        {profiles.map(profile => (
          <button
            key={profile.id}
            type="button"
            className={`agent-chip${selected?.id === profile.id ? ' is-selected' : ''}`}
            aria-pressed={selected?.id === profile.id}
            disabled={saving}
            onClick={() => onSelect(profile.id)}
            title={profile.description}
            style={{ '--agent-color': profile.color } as CSSProperties}
          >
            <span className="agent-chip-icon" aria-hidden="true"><AppIcon name={profile.icon} size={15} /></span>
            <span>{profile.name}</span>
          </button>
        ))}
      </div>
      {error && <p className="agent-picker-error" role="alert">{error}</p>}
    </section>
  );
}
