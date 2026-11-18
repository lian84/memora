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
  archivedView: false,
  onToggleArchivedView: () => undefined,
};

test('la vista attiva usa una sola icona archive accessibile', () => {
  const markup = renderToStaticMarkup(<Sidebar {...baseProps} />);

  expect(markup).toContain('aria-label="Mostra chat archiviate"');
  expect(markup).toContain('title="Chat archiviate"');
  expect(markup).toContain('aria-pressed="false"');
  expect(markup).not.toContain('>Archiviate<');
});

test('la vista archiviate evidenzia il toggle e consente il ritorno alle chat attive', () => {
  const markup = renderToStaticMarkup(<Sidebar {...baseProps} archivedView />);

  expect(markup).toContain('aria-label="Torna alle chat attive"');
  expect(markup).toContain('title="Torna alle chat attive"');
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).not.toContain('>Archiviate<');
});

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
