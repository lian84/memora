import { useEffect, useRef, useState } from 'react';
import type { ProjectRecord } from '@memora/shared';

interface ProjectPickerProps {
  projects: ProjectRecord[];
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void;
  onNew: () => void;
  onEdit: (projectId: string) => void;
  onDelete: (project: ProjectRecord) => void;
  settingsActive?: boolean;
}

function PencilIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
}

function TrashIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg>;
}

function CheckIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
}

export function ProjectPicker({ projects, selectedProjectId, onSelect, onNew, onEdit, onDelete, settingsActive = false }: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = projects.find(project => project.id === selectedProjectId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (projectId: string | null) => {
    onSelect(projectId);
    setOpen(false);
  };

  return (
    <div className="project-picker" ref={rootRef}>
      <label>Progetto</label>
      <button
        type="button"
        className={`project-picker-trigger${settingsActive ? ' is-active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        title={selected ? `Progetto: ${selected.name}` : 'Tutti i progetti'}
      >
        <span className={`project-picker-dot${selected ? ` is-${selected.status}` : ''}`} aria-hidden="true" />
        <span className="project-picker-current">{selected?.name ?? 'Tutti i progetti'}</span>
        <span className="project-picker-count">{projects.length}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="project-picker-menu" role="listbox" aria-label="Seleziona progetto">
          <button type="button" role="option" aria-selected={!selectedProjectId} className={`project-picker-item${!selectedProjectId ? ' is-selected' : ''}`} onClick={() => choose(null)}>
            <span className="project-picker-item-icon">◎</span>
            <span className="project-picker-item-name">Tutti i progetti</span>
            {!selectedProjectId && <span className="project-picker-check"><CheckIcon /></span>}
          </button>
          <div className="project-picker-section">Progetti</div>
          {projects.length === 0 && <div className="project-picker-empty">Nessun progetto. Creane uno per organizzare chat e fonti.</div>}
          {projects.map(project => (
            <div className={`project-picker-project${project.id === selectedProjectId ? ' is-selected' : ''}`} key={project.id}>
              <button type="button" role="option" aria-selected={project.id === selectedProjectId} className="project-picker-item" onClick={() => choose(project.id)}>
                <span className={`project-picker-dot is-${project.status}`} aria-hidden="true" />
                <span className="project-picker-item-name">{project.name}</span>
                {project.id === selectedProjectId && <span className="project-picker-check"><CheckIcon /></span>}
              </button>
              <div className="project-picker-item-actions">
                <button type="button" className="project-picker-action" title={`Modifica ${project.name}`} aria-label={`Modifica ${project.name}`} onClick={() => { setOpen(false); onEdit(project.id); }}>
                  <PencilIcon />
                </button>
                <button type="button" className="project-picker-action is-danger" title={`Elimina ${project.name}`} aria-label={`Elimina ${project.name}`} onClick={() => { setOpen(false); onDelete(project); }}>
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
          <div className="project-picker-footer">
            <button type="button" className="project-picker-new" onClick={() => { setOpen(false); onNew(); }}>+ Nuovo progetto</button>
            {selected && (
              <button type="button" className={`project-picker-edit${settingsActive ? ' is-active' : ''}`} onClick={() => { setOpen(false); onEdit(selected.id); }}>Impostazioni</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
