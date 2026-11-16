import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { SaveMemoryDialog } from './SaveMemoryDialog';

test('mostra contesto, testo e destinazione prima del salvataggio', () => {
  const markup = renderToStaticMarkup(
    <SaveMemoryDialog
      sessionId="session-1"
      content="La carbonara usa il guanciale."
      question="Come si prepara la carbonara?"
      projects={[{ id: 'orione', name: 'Orione' } as never]}
      defaultProjectId="orione"
      onClose={() => undefined}
      onSaved={() => undefined}
    />,
  );
  expect(markup).toContain('Salva come memoria');
  expect(markup).toContain('Come si prepara la carbonara?');
  expect(markup).toContain('Progetto: Orione');
  expect(markup).toContain('Metti in Memory Inbox');
});
