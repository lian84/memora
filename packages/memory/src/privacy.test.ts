import { describe, expect, it } from 'vitest';
import {
  containsPersonalData,
  containsPersonalDataPlaceholder,
  redactPersonalData,
} from './privacy.js';

describe('redazione dati personali per provider esterni', () => {
  it('rimuove email, telefono, IBAN, carta e codice fiscale', () => {
    const input = [
      'Email: mario.rossi@example.com',
      'Telefono: +39 333 123 4567',
      'IBAN: IT60 X054 2811 1010 0000 0123 456',
      'Carta: 4111 1111 1111 1111',
      'CF: RSSMRA85M01H501Z',
    ].join('\n');
    const result = redactPersonalData(input);

    expect(result.redacted).toBe(true);
    expect(result.kinds).toEqual(expect.arrayContaining(['email', 'phone', 'iban', 'card', 'fiscal_code']));
    expect(result.text).not.toContain('mario.rossi@example.com');
    expect(result.text).not.toContain('333 123 4567');
    expect(result.text).not.toContain('IT60 X054');
    expect(result.text).not.toContain('4111 1111');
    expect(result.text).not.toContain('RSSMRA85M01H501Z');
    expect(result.text).toContain('[email-rimossa]');
    expect(result.text).toContain('[telefono-rimosso]');
    expect(result.text).toContain('[iban-rimosso]');
    expect(result.text).toContain('[carta-rimossa]');
    expect(result.text).toContain('[codice-fiscale-rimosso]');
  });

  it('non altera date, versioni o numeri non sensibili', () => {
    const input = 'Il 2026-05-04 usiamo la versione 1.2.3 con 42 richieste e 3 server.';
    const result = redactPersonalData(input);
    expect(result.redacted).toBe(false);
    expect(result.text).toBe(input);
  });

  it('riconosce i segnaposto come non memorizzabili', () => {
    expect(containsPersonalDataPlaceholder('Contatto: [email-rimossa]')).toBe(true);
    expect(containsPersonalDataPlaceholder('Nessun dato rimosso')).toBe(false);
    expect(containsPersonalData('Scrivi a test@example.com')).toBe(true);
    expect(containsPersonalData('PostgreSQL 16')).toBe(false);
  });
});
