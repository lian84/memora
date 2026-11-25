import { describe, expect, it } from 'vitest';
import { localizeServerMessage } from './server-messages';

describe('server message localization', () => {
  it('traduce i codici noti nelle tre lingue', () => {
    expect(localizeServerMessage('session_not_found', 'Sessione non trovata', 404, 'it')).toBe('Sessione non trovata.');
    expect(localizeServerMessage('session_not_found', 'Sessione non trovata', 404, 'en')).toBe('Session not found.');
    expect(localizeServerMessage('session_not_found', 'Sessione non trovata', 404, 'fr')).toBe('Session introuvable.');
  });

  it('usa i pattern per i codici generici', () => {
    expect(localizeServerMessage('invalid_project_name', 'Nome non valido', 400, 'en')).toBe('Invalid input.');
    expect(localizeServerMessage('automation_busy', 'Occupato', 409, 'fr')).toBe('Opération déjà en cours : réessayez bientôt.');
  });

  it('mantiene il messaggio originale per codici sconosciuti senza status utile', () => {
    expect(localizeServerMessage('Bad Request', 'Body cannot be empty', undefined, 'en')).toBe('Body cannot be empty');
  });
});
