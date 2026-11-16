import type { ReasoningLevel } from '@memora/shared';
import { REASONING_LEVELS } from '@memora/shared';

interface ReasoningSelectorProps {
  value: ReasoningLevel;
  onChange: (level: ReasoningLevel) => void;
  disabled?: boolean;
}

export function ReasoningSelector({ value, onChange, disabled = false }: ReasoningSelectorProps) {
  return (
    <div className="reasoning-selector">
      <label className="model-label" htmlFor="reasoning-select">Reasoning</label>
      <select
        id="reasoning-select"
        className="model-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as ReasoningLevel)}
      >
        {REASONING_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
      </select>
    </div>
  );
}
