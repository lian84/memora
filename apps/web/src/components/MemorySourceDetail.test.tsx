import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { MemorySourceDetail } from './MemorySourceDetail';
import type { MemoryHistoryRecord, MemorySourceDetail as SourceDetail } from '../lib/api';

const baseSource: SourceDetail = {
  id: 'source-1',
  path: '/tmp/data/projects/vega/memory.md',
  relativePath: 'projects/vega/memory.md',
  category: 'projects',
  modifiedAt: 1,
  size: 10,
  contentHash: 'hash',
  indexedAt: 1,
  chunkCount: 1,
  title: 'Progetto Vega',
  content: '# Progetto Vega\n\n- Il colore identificativo è turchese.',
};

const props = {
  onBack: () => undefined,
  onSaved: () => undefined,
  onDeleted: () => undefined,
};

test('una fonte progetto mostra modifica ed eliminazione', () => {
  const markup = renderToStaticMarkup(<MemorySourceDetail source={baseSource} {...props} />);
  expect(markup).toContain('Modifica');
  expect(markup).toContain('Elimina');
  expect(markup).toContain('projects/vega/memory.md');
});

test('un file core resta modificabile ma non mostra la cancellazione completa', () => {
  const markup = renderToStaticMarkup(
    <MemorySourceDetail
      source={{ ...baseSource, relativePath: 'memory/profile.md', path: '/tmp/data/memory/profile.md', title: 'Profilo' }}
      {...props}
    />,
  );
  expect(markup).toContain('Modifica');
  expect(markup).toContain('File core condiviso');
  expect(markup).not.toMatch(/>Elimina</);
});


test('mostra le versioni attive e superate con provenienza', () => {
  const history: MemoryHistoryRecord[] = [
    { memoryId: 'mem_vega', versionId: 'ver_1', version: 1, status: 'superseded', text: 'Vega usa il turchese.', relativePath: 'projects/vega/memory.md', line: 4, createdAt: 1, updatedAt: 2, supersededBy: 'ver_2', sourceSessionId: 'session-1', curatorProvider: 'opencode-go', curatorModel: 'fake-model' },
    { memoryId: 'mem_vega', versionId: 'ver_2', version: 2, status: 'active', text: 'Vega usa il rosso.', relativePath: 'projects/vega/memory.md', line: 5, createdAt: 1, updatedAt: 3, supersededBy: null },
  ];
  const markup = renderToStaticMarkup(<MemorySourceDetail source={baseSource} history={history} {...props} />);
  expect(markup).toContain('Storico versioni (2)');
  expect(markup).toContain('Superata');
  expect(markup).toContain('Attiva');
  expect(markup).toContain('Vega usa il turchese.');
  expect(markup).toContain('Vega usa il rosso.');
  expect(markup).toContain('opencode-go / fake-model');
});
