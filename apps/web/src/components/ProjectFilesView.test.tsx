import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ProjectFilesView } from './ProjectFilesView';
import type { ProjectRecord } from '@memora/shared';

const project: ProjectRecord = {
  version: 1,
  id: 'orione',
  name: 'Orione',
  description: '',
  status: 'active',
  prompt: '',
  defaults: {},
  retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
  sources: { include: ['**/*.md'], exclude: [] },
  createdAt: 1,
  updatedAt: 1,
  source: 'file',
};

test('mostra la vista file del progetto', () => {
  const markup = renderToStaticMarkup(<ProjectFilesView project={project} />);
  expect(markup).toContain('Cerca file');
  expect(markup).toContain('Aggiorna file');
  expect(markup).toContain('Caricamento file');
});
