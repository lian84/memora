import type { ReasoningLevel } from '@memora/shared';
import { REASONING_LEVELS } from '@memora/shared';
import { useI18n } from '../i18n';

interface ReasoningSelectorProps {
  value: ReasoningLevel;
  onChange: (level: ReasoningLevel) => void;
  disabled?: boolean;
}

export function ReasoningSelector({ value, onChange, disabled = false }: ReasoningSelectorProps) {
  const { t } = useI18n();
  return (
    <label className="admin-label chat-model-field" htmlFor="reasoning-select">
      <span>{t('Reasoning')}</span>
      <select
        id="reasoning-select"
        className="model-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as ReasoningLevel)}
      >
        {REASONING_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
      </select>
    </label>
  );
}
