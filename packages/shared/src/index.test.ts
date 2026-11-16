import { expect, test } from 'vitest';
import { APP_NAME, normalizePiContent } from './index';

test('APP_NAME exported', () => {
  expect(APP_NAME).toBe('memora');
});

test('normalizza solo i content block text', () => {
  expect(
    normalizePiContent([
      { type: 'thinking', thinking: 'ragionamento interno' },
      { type: 'text', text: 'Puoi chiamarmi ' },
      { type: 'text', text: 'Nemotron.' },
    ]),
  ).toBe('Puoi chiamarmi Nemotron.');
});

test('non espone thinkingSignature né blocchi sconosciuti', () => {
  expect(
    normalizePiContent([
      {
        type: 'thinking',
        thinking: 'interno',
        thinkingSignature: 'mai-renderizzare',
      },
      { type: 'reasoning', text: 'non visibile' },
      { type: 'future_block', value: 'non visibile' },
      { type: 'text', text: 'Risposta visibile.' },
    ]),
  ).toBe('Risposta visibile.');
});

test('storico e streaming producono lo stesso visibleText', () => {
  const history = normalizePiContent([
    { type: 'thinking', thinking: 'interno' },
    { type: 'text', text: 'Ciao da ' },
    { type: 'text', text: 'Memora.' },
  ]);
  const deltas = ['Ciao ', 'da ', 'Memora.'];
  const streaming = deltas
    .map((delta) => normalizePiContent([{ type: 'text', text: delta }]))
    .join('');

  expect(streaming).toBe(history);
});

test('memory_sources non entra nel testo assistant', () => {
  expect(
    normalizePiContent([
      {
        relativePath: 'projects/example.md',
        category: 'projects',
        heading: 'Example',
      },
    ]),
  ).toBe('');
});
