import { useState } from 'react';
import type { ProjectRecord } from '@memora/shared';
import { deleteProject } from '../lib/api';
import { ConfirmDialog } from './ConfirmDialog';

interface ProjectDeleteDialogProps {
  project: ProjectRecord;
  onClose: () => void;
  onDeleted: (projectId: string) => void;
}

export function ProjectDeleteDialog({ project, onClose, onDeleted }: ProjectDeleteDialogProps) {
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
      title={`Eliminare il progetto “${project.name}”?`}
      confirmLabel="Elimina progetto"
      busyLabel="Eliminazione…"
      busy={deleting}
      error={error}
      confirmDisabled={confirmation !== project.id}
      cancelAutoFocus={false}
      onClose={onClose}
      onConfirm={() => void remove()}
    >
      <p>Il progetto e le sue fonti verranno spostati nel cestino di Memora. Le chat esistenti non vengono cancellate.</p>
      <label className="admin-label project-delete-confirm">Per confermare, scrivi <code>{project.id}</code>
        <input autoFocus value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={project.id} disabled={deleting} />
      </label>
    </ConfirmDialog>
  );
}
