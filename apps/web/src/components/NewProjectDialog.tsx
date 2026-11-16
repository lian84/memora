import { useState } from 'react';
import type { ProjectRecord } from '@memora/shared';
import { createProject, reindexMemory } from '../lib/api';
import { useI18n } from '../i18n';

interface NewProjectDialogProps {
  onClose: () => void;
  onCreated: (project: ProjectRecord) => void;
}

export function NewProjectDialog({ onClose, onCreated }: NewProjectDialogProps) {
  const { t } = useI18n();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const project = await createProject({ id: id.trim(), name: name.trim() || id.trim(), description: description.trim() });
      await reindexMemory().catch(() => undefined);
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="presentation" className="dialog-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="new-project-title" className="delete-dialog project-create-dialog" onClick={event => event.stopPropagation()}>
        <h2 id="new-project-title">{t('Nuovo progetto')}</h2>
        <p>{t('Verranno creati <code>project.json</code> e <code>memory.md</code> nella directory del progetto.')}</p>
        {error && <p role="alert" className="delete-dialog-error">{error}</p>}
        <label className="admin-label">{t('ID progetto')}
          <input value={id} onChange={event => setId(event.target.value.toLowerCase())} placeholder="orione" autoFocus />
          <small>{t('Solo lettere minuscole, numeri e trattini. Non modificabile.')}</small>
        </label>
        <label className="admin-label">{t('Nome')}
          <input value={name} onChange={event => setName(event.target.value)} placeholder="Orione" />
        </label>
        <label className="admin-label">{t('Descrizione')}
          <textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={saving}>{t('Annulla')}</button>
          <button type="button" className="admin-primary" onClick={() => void create()} disabled={saving || !id.trim()}>{saving ? t('Creo…') : t('Crea progetto')}</button>
        </div>
      </div>
    </div>
  );
}
