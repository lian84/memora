import { expect, test } from 'vitest';
import { renderMarkdown } from './markdown';

test('non interpreta HTML grezzo proveniente dal modello', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n**grassetto**');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('<strong>grassetto</strong>');
});

test('nasconde i commenti metadata delle memorie', () => {
  const html = renderMarkdown('- Fatto utile. <!-- memora-memory:v1 {"x":1} -->');
  expect(html).toContain('Fatto utile.');
  expect(html).not.toContain('memora-memory');
});
