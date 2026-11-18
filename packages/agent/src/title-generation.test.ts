import { describe, expect, it } from 'vitest';
import { fallbackSessionTitle, sanitizeSessionTitle } from './title-generation.js';

describe('session title helpers', () => {
  it('crea un fallback breve dal primo messaggio', () => {
    expect(fallbackSessionTitle('  ## Mi trovi le **cinque** notizie più importanti di oggi?  '))
      .toBe('Mi trovi le cinque notizie più importanti di oggi');
    expect(fallbackSessionTitle('```html\n<h1>Ignora</h1>\n```')).toBe('Nuova chat');
  });

  it('normalizza il titolo generato dal modello', () => {
    expect(sanitizeSessionTitle('  "Titolo: **Notizie di oggi**."  ')).toBe('Notizie di oggi');
    expect(sanitizeSessionTitle("```\nOrganizzazione trasloco\n```")).toBe('Organizzazione trasloco');
  });

  it('rifiuta titoli vuoti o non testuali', () => {
    expect(sanitizeSessionTitle('')).toBeNull();
    expect(sanitizeSessionTitle(null)).toBeNull();
    expect(sanitizeSessionTitle('   "`  ')).toBeNull();
  });
});
