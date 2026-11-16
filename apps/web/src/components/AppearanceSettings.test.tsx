import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { AppearanceSettings } from './AppearanceSettings';

test('mostra tema, dimensione testo e opzioni di lettura', () => {
  const markup = renderToStaticMarkup(<AppearanceSettings />);
  expect(markup).toContain('Aspetto');
  expect(markup).toContain('Tema');
  expect(markup).toContain('Dimensione testo');
  expect(markup).toContain('Riduci animazioni e scorrimento');
  expect(markup).toContain('Mantieni la barra chat compressa');
  expect(markup).toContain('Ripristina');
});
