import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { Sidebar } from './Sidebar';

const session = {
  sessionId: 'session-1',
  sessionFile: '/tmp/session-1.jsonl',
  cwd: '/tmp',
  created: new Date('2024-01-01'),
  modified: new Date('2024-01-02'),
  messageCount: 1,
  firstMessage: 'Fixture',
  archived: false,
};

const baseProps = {
  sessions: [session],
  onSelect: () => undefined,
  onCreate: async () => 'new-session',
  onRename: async () => undefined,
  onArchive: async () => undefined,
  onDelete: async () => undefined,
  selectedSessionId: null,
  loading: false,
  error: null,
};

test('una nuova chat in memoria compare subito come bozza eliminabile', () => {
  const markup = renderToStaticMarkup(
    <Sidebar {...baseProps} sessions={[{ ...session, draft: true, firstMessage: '' }]} />,
  );

  expect(markup).toContain('Nuova chat');
  expect(markup).toContain('aria-label="Azioni chat Nuova chat"');
  expect(markup).not.toContain('title="Rinomina"');
  expect(markup).not.toContain('title="Archivia"');
});

test('la sidebar espone lo stato compresso', () => {
  const markup = renderToStaticMarkup(<Sidebar {...baseProps} collapsed />);
  expect(markup).toContain('sidebar is-collapsed');
});

test('le azioni finali sono icone accessibili', () => {
  const markup = renderToStaticMarkup(<Sidebar {...baseProps} onOpenSettings={() => undefined} onOpenSecondBrain={() => undefined} />);
  expect(markup).toContain('aria-label="Second Brain"');
  expect(markup).toContain('aria-label="Impostazioni"');
  expect(markup).not.toContain('>Impostazioni<');
});

test('mostra le sezioni e i progetti annidati', () => {
  const markup = renderToStaticMarkup(
    <Sidebar
      {...baseProps}
      sections={[{ id: 'lavoro', name: 'Lavoro', icon: 'briefcase', order: 0, createdAt: 1, updatedAt: 1 }]}
      projects={[{
        version: 1, id: 'orione', name: 'Orione', description: '', status: 'active', prompt: '',
        defaults: {}, retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
        sources: { include: ['**/*.md'], exclude: [] }, createdAt: 1, updatedAt: 1, source: 'file', sectionId: 'lavoro', icon: 'rocket',
      }]}
      sessions={[{ ...session, projectId: 'orione' }]}
    />,
  );
  expect(markup).toContain('Sezioni');
  expect(markup).toContain('Lavoro');
  expect(markup).toContain('Orione');
  expect(markup).toContain('aria-label="Azioni sezione Lavoro"');
  expect(markup).toContain('aria-label="Azioni progetto Orione"');
});

test('mostra i pallini di risposta in corso e non letta', () => {
  const markup = renderToStaticMarkup(
    <Sidebar
      {...baseProps}
      sessions={[session, { ...session, sessionId: 'session-2' }]}
      selectedSessionId="session-2"
      turnStatuses={{ 'session-1': 'running', 'session-2': 'completed' }}
      unreadSessions={new Set(['session-2'])}
    />,
  );
  expect(markup).toContain('Risposta in corso in un’altra chat');
  expect(markup).toContain('Risposta non letta');
});

test('mostra l’icona del profilo agente accanto alla sessione', () => {
  const markup = renderToStaticMarkup(
    <Sidebar {...baseProps} sessions={[{ ...session, agent: { id: 'commercialista', name: 'Commercialista', icon: 'calculator', color: '#0f8a6a' } }]} />,
  );
  expect(markup).toContain('Chat con Commercialista');
  expect(markup).toContain('session-agent-icon');
});

test('marca come archiviata una chat archiviata visibile', () => {
  const markup = renderToStaticMarkup(
    <Sidebar {...baseProps} sessions={[{ ...session, archived: true }]} />,
  );
  expect(markup).toContain('is-archived');
});

test('nasconde le chat archiviate del progetto salvo impostazione esplicita', () => {
  const archivedProject = {
    version: 1 as const, id: 'orione', name: 'Orione', description: '', status: 'active' as const, prompt: '',
    showArchivedSessions: false,
    defaults: {}, retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
    sources: { include: ['**/*.md'], exclude: [] }, createdAt: 1, updatedAt: 1, source: 'file' as const, icon: 'rocket' as const,
  };
  const archivedSession = { ...session, sessionId: 'archived-project-session', projectId: 'orione', archived: true, firstMessage: 'Chat archiviata progetto' };
  const hidden = renderToStaticMarkup(<Sidebar {...baseProps} projects={[archivedProject]} sessions={[archivedSession]} selectedProjectId="orione" />);
  expect(hidden).not.toContain('Chat archiviata progetto');

  const shown = renderToStaticMarkup(<Sidebar {...baseProps} projects={[{ ...archivedProject, showArchivedSessions: true }]} sessions={[archivedSession]} selectedProjectId="orione" />);
  expect(shown).toContain('Chat archiviata progetto');
  expect(shown).toContain('is-archived');
});

test('mostra il pulsante automazione e le automazioni dentro il progetto', () => {
  const project = {
    version: 1 as const, id: 'orione', name: 'Orione', description: '', status: 'active' as const, prompt: '',
    defaults: {}, retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
    sources: { include: ['**/*.md'], exclude: [] }, createdAt: 1, updatedAt: 1, source: 'file' as const, icon: 'rocket' as const,
  };
  const markup = renderToStaticMarkup(
    <Sidebar
      {...baseProps}
      projects={[project]}
      automations={[{ id: 'job_1', name: 'Riepilogo', prompt: 'Riepilogo', cron: '0 9 * * *', timezone: 'Europe/Rome', enabled: true, projectId: 'orione', mcp: { enabled: [] }, notifyTelegram: false, webEnabled: false, timeoutMinutes: 10, maxAttempts: 1, createdAt: 1, updatedAt: 1 }]}
      onCreateAutomation={() => undefined}
      onSelectAutomation={() => undefined}
      selectedProjectId="orione"
    />,
  );
  expect(markup).toContain('title="Nuova automazione"');
  expect(markup).toContain('class="new-automation-button"');
  expect(markup).toContain('Riepilogo');
  expect(markup).toContain('sidebar-project-automations');
  expect(markup).toContain('Automazioni');
});

test('espone la pagina con tutte le automazioni', () => {
  const markup = renderToStaticMarkup(
    <Sidebar
      {...baseProps}
      automations={[{ id: 'job_1', name: 'Riepilogo', prompt: 'Riepilogo', cron: '0 9 * * *', timezone: 'Europe/Rome', enabled: true, mcp: { enabled: [] }, notifyTelegram: false, webEnabled: false, timeoutMinutes: 10, maxAttempts: 1, createdAt: 1, updatedAt: 1 }]}
      onOpenAutomations={() => undefined}
    />,
  );
  expect(markup).toContain('Tutte le automazioni');
  expect(markup).toContain('sidebar-automations-link');
  expect(markup).toContain('sidebar-automations-link-count');
});
