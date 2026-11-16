import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { ProjectRecord } from '@memora/shared';
import { ProjectSettings } from './ProjectSettings';

const project: ProjectRecord = {
  version: 1, id: 'orione', name: 'Orione', description: 'Progetto demo', status: 'active',
  prompt: 'Rispondi in modo conciso.', defaults: {}, retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
  sources: { include: ['memory.md', 'sources/**/*.md'], exclude: [] }, createdAt: 1, updatedAt: 2, source: 'file',
};

describe('ProjectSettings', () => {
  test('mostra profilo, prompt e fonti del progetto', () => {
    const markup = renderToStaticMarkup(<ProjectSettings project={project} onClose={() => {}} onSaved={() => {}} onSourcesChanged={() => {}} />);
    expect(markup).toContain('Profilo e prompt');
    expect(markup).toContain('Prompt di progetto');
    expect(markup).toContain('Fonti del progetto');
    expect(markup).toContain('projects/orione/sources/');
    expect(markup).toContain('Carica file .md o .txt');
    expect(markup).toContain('Rispondi in modo conciso.');
  });
});
