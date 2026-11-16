import { useState } from 'react';
import type { ProjectRecord } from '@memora/shared';
import { deleteProject } from '../lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { useI18n } from '../i18n';

interface ProjectDeleteDialogProps {
  project: ProjectRecord;
  onClose: () => void;
  onDeleted: (projectId: string) => void;
}

export function ProjectDeleteDialog({ project, onClose, onDeleted }: ProjectDeleteDialogProps) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (confirmation !== project.id) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProject(project.id, confirmation);
      onDeleted(project.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ConfirmDialog
      title={`${t('Elimina progetto')}: “${project.name}”?`}
      confirmLabel={t('Elimina progetto')}
      busyLabel={t('Eliminazione…')}
      busy={deleting}
      error={error}
      confirmDisabled={confirmation !== project.id}
      cancelAutoFocus={false}
      onClose={onClose}
      onConfirm={() => void remove()}
    >
      <p>{t('Il progetto e le sue fonti verranno spostati nel cestino di Memora. Le chat esistenti non vengono cancellate.')}</p>
      <label className="admin-label project-delete-confirm">{t('Per confermare, scrivi')} <code>{project.id}</code>
        <input autoFocus value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={project.id} disabled={deleting} />
      </label>
    </ConfirmDialog>
  );
}
