import { useState } from 'react';
import type { ProjectIcon, ProjectSection } from '@memora/shared';
import { createProjectSection, updateProjectSection } from '../lib/api';
import { IconPicker } from './IconPicker';
import { useI18n } from '../i18n';

interface SectionDialogProps {
  section?: ProjectSection | null;
  onClose: () => void;
  onSaved: (section: ProjectSection) => void;
}

export function SectionDialog({ section = null, onClose, onSaved }: SectionDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState(section?.name ?? '');
  const [icon, setIcon] = useState<ProjectIcon>(section?.icon ?? 'folder');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = section
        ? await updateProjectSection(section.id, { name: name.trim(), icon })
        : await createProjectSection({ name: name.trim(), icon });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="presentation" className="dialog-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="section-dialog-title" className="delete-dialog project-create-dialog" onClick={event => event.stopPropagation()}>
        <h2 id="section-dialog-title">{t(section ? 'Modifica sezione' : 'Nuova sezione')}</h2>
        <p>{t('Le sezioni raggruppano i progetti nella barra laterale.')}</p>
        {error && <p role="alert" className="delete-dialog-error">{error}</p>}
        <label className="admin-label">{t('Nome')}
          <input value={name} onChange={event => setName(event.target.value)} placeholder={t('Lavoro')} autoFocus />
        </label>
        <label className="admin-label">{t('Icona')}
          <IconPicker value={icon} onChange={setIcon} />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={saving}>{t('Annulla')}</button>
          <button type="button" className="admin-primary" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? t('Salvo…') : t('Salva sezione')}</button>
        </div>
      </div>
    </div>
  );
}
