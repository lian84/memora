import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProjectRecord, ProjectSection } from '@memora/shared';
import type { SessionInfo } from '../lib/api';
import { AppIcon } from './AppIcon';
import { RowMenu } from './RowMenu';
import { useI18n } from '../i18n';

const SECTION_STATE_KEY = 'memora-sidebar-open-sections';
const PROJECT_STATE_KEY = 'memora-sidebar-open-projects';
const UNASSIGNED_PROJECTS = '__unassigned-projects__';

function readSet(key: string): Set<string> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((value): value is string => typeof value === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function persistSet(key: string, values: Set<string>): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify([...values])); } catch { /* storage may be unavailable */ }
}

function Chevron({ open }: { open: boolean }) {
  return <svg className={`sidebar-tree-chevron${open ? ' is-open' : ''}`} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>;
}

function PlusIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function PencilIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
}

function TrashIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6" /></svg>;
}

function SettingsIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.6" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.9 2.9-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.1h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7.1 4.1l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.9 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.6 1Z" /></svg>;
}

interface SidebarTreeProps {
  sections: ProjectSection[];
  projects: ProjectRecord[];
  sessions: SessionInfo[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onEditProject: (projectId: string) => void;
  onNewProject: (sectionId: string | null) => void;
  onNewSection: () => void;
  onEditSection: (section: ProjectSection) => void;
  onDeleteSection: (section: ProjectSection) => void;
  onNewChatInProject: (projectId: string) => Promise<unknown> | void;
  renderSessions: (sessions: SessionInfo[]) => ReactNode;
}

export function SidebarTree({
  sections,
  projects,
  sessions,
  selectedProjectId,
  onSelectProject,
  onEditProject,
  onNewProject,
  onNewSection,
  onEditSection,
  onDeleteSection,
  onNewChatInProject,
  renderSessions,
}: SidebarTreeProps) {
  const { t } = useI18n();
  const storedSections = useRef(readSet(SECTION_STATE_KEY));
  const storedProjects = useRef(readSet(PROJECT_STATE_KEY));
  const initialized = useRef(false);
  const knownSections = useRef<Set<string>>(new Set());
  const [openSections, setOpenSections] = useState<Set<string>>(() => storedSections.current ?? new Set([UNASSIGNED_PROJECTS, ...sections.map(section => section.id)]));
  const [openProjects, setOpenProjects] = useState<Set<string>>(() => new Set([...(storedProjects.current ?? []), ...(selectedProjectId ? [selectedProjectId] : [])]));

  useEffect(() => {
    const addedSections = sections.filter(section => !knownSections.current.has(section.id));
    for (const section of addedSections) knownSections.current.add(section.id);
    if (sections.length === 0 && projects.length === 0) return;
    if (!initialized.current) {
      initialized.current = true;
      if (!storedSections.current) setOpenSections(new Set([UNASSIGNED_PROJECTS, ...sections.map(section => section.id)]));
      if (!storedProjects.current && selectedProjectId) setOpenProjects(new Set([selectedProjectId]));
      return;
    }
    if (addedSections.length > 0) {
      setOpenSections(current => {
        const next = new Set(current);
        for (const section of addedSections) next.add(section.id);
        persistSet(SECTION_STATE_KEY, next);
        return next;
      });
    }
  }, [projects.length, sections, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const project = projects.find(item => item.id === selectedProjectId);
    if (!project) return;
    setOpenProjects(current => {
      if (current.has(project.id)) return current;
      const next = new Set(current).add(project.id);
      persistSet(PROJECT_STATE_KEY, next);
      return next;
    });
    const sectionKey = project.sectionId && sections.some(section => section.id === project.sectionId) ? project.sectionId : UNASSIGNED_PROJECTS;
    setOpenSections(current => {
      if (current.has(sectionKey)) return current;
      const next = new Set(current).add(sectionKey);
      persistSet(SECTION_STATE_KEY, next);
      return next;
    });
  }, [projects, sections, selectedProjectId]);

  const projectsBySection = new Map<string, ProjectRecord[]>();
  for (const section of sections) projectsBySection.set(section.id, []);
  const unassignedProjects: ProjectRecord[] = [];
  for (const project of projects) {
    if (project.sectionId && projectsBySection.has(project.sectionId)) projectsBySection.get(project.sectionId)!.push(project);
    else unassignedProjects.push(project);
  }

  const sessionsByProject = new Map<string, SessionInfo[]>();
  const unassignedSessions: SessionInfo[] = [];
  const projectById = new Map(projects.map(project => [project.id, project]));
  for (const session of sessions) {
    const project = session.projectId ? projectById.get(session.projectId) : undefined;
    // Le chat archiviate di un progetto restano nel progetto ma sono visibili
    // solo se il progetto ha esplicitamente abilitato la vista delle archiviate.
    if (session.archived && project && project.showArchivedSessions !== true) continue;
    if (project) {
      const list = sessionsByProject.get(project.id) ?? [];
      list.push(session);
      sessionsByProject.set(project.id, list);
    } else {
      unassignedSessions.push(session);
    }
  }

  const toggleSection = (id: string) => {
    setOpenSections(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      persistSet(SECTION_STATE_KEY, next);
      return next;
    });
  };

  const toggleProject = (id: string) => {
    setOpenProjects(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      persistSet(PROJECT_STATE_KEY, next);
      return next;
    });
  };

  const chooseProject = (project: ProjectRecord) => {
    onSelectProject(project.id);
    setOpenProjects(current => {
      if (current.has(project.id)) return current;
      const next = new Set(current).add(project.id);
      persistSet(PROJECT_STATE_KEY, next);
      return next;
    });
  };

  const renderProject = (project: ProjectRecord) => {
    const projectSessions = sessionsByProject.get(project.id) ?? [];
    const open = openProjects.has(project.id);
    const active = project.id === selectedProjectId;
    return (
      <div className={`sidebar-project${active ? ' is-active' : ''}`} key={project.id}>
        <div className="sidebar-tree-row sidebar-project-row">
          <button type="button" className="sidebar-tree-toggle" aria-label={t(open ? 'Chiudi progetto' : 'Apri progetto')} aria-expanded={open} onClick={() => toggleProject(project.id)}>
            <Chevron open={open} />
          </button>
          <button type="button" className="sidebar-tree-label" onClick={() => chooseProject(project)} title={project.description || project.name}>
            <span className="sidebar-project-icon"><AppIcon name={project.icon ?? 'folder'} size={14} /></span>
            <span className="sidebar-tree-name">{project.name}</span>
            {projectSessions.length > 0 && <span className="sidebar-tree-count">{projectSessions.length}</span>}
          </button>
          <RowMenu
            label={`${t('Azioni progetto')} ${project.name}`}
            items={[
              { label: t('Nuova chat nel progetto'), icon: <PlusIcon />, onSelect: () => { void onNewChatInProject(project.id); } },
              { label: t('Impostazioni progetto'), icon: <SettingsIcon />, onSelect: () => onEditProject(project.id) },
            ]}
          />
        </div>
        {open && (
          <div className="sidebar-project-sessions">
            {projectSessions.length > 0 ? renderSessions(projectSessions) : <div className="sidebar-tree-empty">{t('Nessuna chat in questo progetto.')}</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sidebar-tree">
      <div className="sidebar-tree-heading">
        <span>{t('Sezioni')}</span>
        <button type="button" className="sidebar-tree-heading-action" onClick={onNewSection} title={t('Nuova sezione')} aria-label={t('Nuova sezione')}><PlusIcon /></button>
      </div>
      {sections.length === 0 && unassignedProjects.length === 0 && (
        <div className="sidebar-tree-empty sidebar-tree-empty-large">
          <p>{t('Organizza i progetti in sezioni.')}</p>
          <button type="button" className="sidebar-tree-empty-button" onClick={onNewSection}>{t('Crea la prima sezione')}</button>
        </div>
      )}
      {sections.map(section => {
        const sectionProjects = projectsBySection.get(section.id) ?? [];
        const open = openSections.has(section.id);
        return (
          <section className="sidebar-section" key={section.id}>
            <div className="sidebar-tree-row sidebar-section-row">
              <button type="button" className="sidebar-tree-toggle" aria-label={t(open ? 'Chiudi sezione' : 'Apri sezione')} aria-expanded={open} onClick={() => toggleSection(section.id)}>
                <Chevron open={open} />
              </button>
              <button type="button" className="sidebar-tree-label" onClick={() => toggleSection(section.id)}>
                <span className="sidebar-section-icon"><AppIcon name={section.icon} size={15} /></span>
                <span className="sidebar-tree-name">{section.name}</span>
                {sectionProjects.length > 0 && <span className="sidebar-tree-count">{sectionProjects.length}</span>}
              </button>
              <RowMenu
                label={`${t('Azioni sezione')} ${section.name}`}
                items={[
                  { label: t('Nuovo progetto nella sezione'), icon: <PlusIcon />, onSelect: () => onNewProject(section.id) },
                  { label: t('Modifica sezione'), icon: <PencilIcon />, onSelect: () => onEditSection(section) },
                  { label: t('Elimina sezione'), icon: <TrashIcon />, danger: true, onSelect: () => onDeleteSection(section) },
                ]}
              />
            </div>
            {open && (
              <div className="sidebar-section-projects">
                {sectionProjects.length > 0 ? sectionProjects.map(renderProject) : <div className="sidebar-tree-empty">{t('Nessun progetto in questa sezione.')}</div>}
              </div>
            )}
          </section>
        );
      })}
      {(unassignedProjects.length > 0 || unassignedSessions.length > 0) && (
        <section className="sidebar-section">
          <div className="sidebar-tree-row sidebar-section-row">
            <button type="button" className="sidebar-tree-toggle" aria-label={t(openSections.has(UNASSIGNED_PROJECTS) ? 'Chiudi sezione' : 'Apri sezione')} aria-expanded={openSections.has(UNASSIGNED_PROJECTS)} onClick={() => toggleSection(UNASSIGNED_PROJECTS)}>
              <Chevron open={openSections.has(UNASSIGNED_PROJECTS)} />
            </button>
            <button type="button" className="sidebar-tree-label" onClick={() => toggleSection(UNASSIGNED_PROJECTS)}>
              <span className="sidebar-section-icon"><AppIcon name="folder" size={15} /></span>
              <span className="sidebar-tree-name">{t('Senza sezione')}</span>
            </button>
          </div>
          {openSections.has(UNASSIGNED_PROJECTS) && (
            <div className="sidebar-section-projects">
              {unassignedProjects.map(renderProject)}
              {unassignedSessions.length > 0 && (
                <div className="sidebar-project sidebar-project-unassigned">
                  <div className="sidebar-tree-row sidebar-project-row">
                    <span className="sidebar-tree-toggle-spacer" />
                    <span className="sidebar-tree-label sidebar-tree-label-static">
                      <span className="sidebar-project-icon"><AppIcon name="folder" size={14} /></span>
                      <span className="sidebar-tree-name">{t('Chat senza progetto')}</span>
                    </span>
                  </div>
                  <div className="sidebar-project-sessions">{renderSessions(unassignedSessions)}</div>
                </div>
              )}
              {unassignedProjects.length === 0 && unassignedSessions.length === 0 && <div className="sidebar-tree-empty">{t('Nessun progetto.')}</div>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
