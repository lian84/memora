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

test('rende cliccabili solo le citazioni numeriche con una fonte mappata', () => {
  const html = renderMarkdown('Il fatto è riportato [1] e anche [2].', {
    citations: new Map([[1, 'https://example.com/fonte']]),
  });
  expect(html).toContain('class="message-citation"');
  expect(html).toContain('href="https://example.com/fonte"');
  expect(html).toContain('[1]');
  expect(html).toContain('[2]');
  expect((html.match(/class="message-citation"/g) ?? [])).toHaveLength(1);
});

test('non trasforma in link le citazioni dentro il codice inline', () => {
  const html = renderMarkdown('`[1]` e [1]', {
    citations: new Map([[1, 'https://example.com/fonte']]),
  });
  expect(html).toContain('<code>[1]</code>');
  expect((html.match(/class="message-citation"/g) ?? [])).toHaveLength(1);
});

test('rifiuta URL non HTTP nelle citazioni', () => {
  const html = renderMarkdown('Fatto [1].', {
    citations: new Map([[1, 'javascript:alert(1)']]),
  });
  expect(html).not.toContain('message-citation');
  expect(html).toContain('[1]');
});
