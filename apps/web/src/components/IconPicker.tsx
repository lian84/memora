import { PROJECT_ICON_NAMES, type ProjectIcon } from '@memora/shared';
import { AppIcon } from './AppIcon';
import { useI18n } from '../i18n';

interface IconPickerProps {
  value: ProjectIcon;
  onChange: (value: ProjectIcon) => void;
  label?: string;
}

export function IconPicker({ value, onChange, label }: IconPickerProps) {
  const { t } = useI18n();
  return (
    <div className="icon-picker" role="group" aria-label={label ?? t('Icona')}>
      {PROJECT_ICON_NAMES.map(icon => (
        <button
          key={icon}
          type="button"
          className={`icon-picker-option${icon === value ? ' is-selected' : ''}`}
          aria-label={t(icon)}
          aria-pressed={icon === value}
          title={t(icon)}
          onClick={() => onChange(icon)}
        >
          <AppIcon name={icon} size={16} />
        </button>
      ))}
    </div>
  );
}
