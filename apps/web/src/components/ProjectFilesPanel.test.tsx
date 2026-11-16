import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ProjectFilesPanel } from './ProjectFilesPanel';
import type { ProjectRecord } from '@memora/shared';

const project: ProjectRecord = {
  version: 1, id: 'orione', name: 'Orione', description: '', status: 'active', prompt: '',
  defaults: {}, retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
  sources: { include: ['**/*.md'], exclude: [] }, createdAt: 1, updatedAt: 1, source: 'file',
};

test('mostra il pannello file del progetto', () => {
  const markup = renderToStaticMarkup(<ProjectFilesPanel project={project} onToggleExpanded={() => undefined} />);
  expect(markup).toContain('File del progetto');
  expect(markup).toContain('Cerca file');
  expect(markup).toContain('Espandi pannello');
});
