import { expect, test } from 'vitest';
import { selectedSessionAfterDelete } from './selectionState';

test('cancellazione sessione selezionata azzera la selezione', () => {
  expect(selectedSessionAfterDelete('selected-session', 'selected-session')).toBeNull();
});

test('cancellazione sessione non selezionata conserva la chat corrente', () => {
  expect(selectedSessionAfterDelete('selected-session', 'other-session')).toBe('selected-session');
});
