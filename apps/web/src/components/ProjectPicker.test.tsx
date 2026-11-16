import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ProjectPicker } from './ProjectPicker';

test('mostra il progetto attivo e il numero di progetti', () => {
  const markup = renderToStaticMarkup(
    <ProjectPicker
      projects={[{ id: 'orione', name: 'Orione', description: '', status: 'active', prompt: '', defaults: {}, retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true }, sources: { include: [], exclude: [] }, createdAt: 1, updatedAt: 1, source: 'file', version: 1 }]}
      selectedProjectId="orione"
      onSelect={() => undefined}
      onNew={() => undefined}
      onEdit={() => undefined}
      onDelete={() => undefined}
    />,
  );
  expect(markup).toContain('Orione');
  expect(markup).toContain('>1<');
  expect(markup).toContain('aria-haspopup="listbox"');
});
