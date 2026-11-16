export type PersonalDataKind = 'email' | 'phone' | 'card' | 'iban' | 'fiscal_code';

export const PERSONAL_DATA_PLACEHOLDERS: Record<PersonalDataKind, string> = {
  email: '[email-rimossa]',
  phone: '[telefono-rimosso]',
  card: '[carta-rimossa]',
  iban: '[iban-rimosso]',
  fiscal_code: '[codice-fiscale-rimosso]',
};

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const FISCAL_CODE_PATTERN = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gi;
const CARD_CANDIDATE_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE_PATTERN = /(?<![\w.])(?:\+\d{1,3}[\s.-]?(?:\d[\s.-]?){6,12}\d|\b(?:3\d{2}(?:[\s.-]?\d){6,7}|0\d{1,3}(?:[\s.-]?\d){6,8})\b)(?![\w])/g;
const PLACEHOLDER_PATTERN = /\[(?:email|telefono|carta|iban|codice-fiscale)-rimoss[oa]\]/i;

function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export interface PersonalDataRedaction {
  text: string;
  redacted: boolean;
  kinds: PersonalDataKind[];
}

/**
 * Rimuove identificatori ad alta confidenza prima di un invio a un provider
 * esterno. Non pretende di riconoscere nomi, indirizzi o PII arbitrarie.
 */
export function redactPersonalData(value: string): PersonalDataRedaction {
  const kinds = new Set<PersonalDataKind>();
  let text = value;

  text = text.replace(EMAIL_PATTERN, () => {
    kinds.add('email');
    return PERSONAL_DATA_PLACEHOLDERS.email;
  });
  text = text.replace(FISCAL_CODE_PATTERN, () => {
    kinds.add('fiscal_code');
    return PERSONAL_DATA_PLACEHOLDERS.fiscal_code;
  });
  text = text.replace(IBAN_PATTERN, () => {
    kinds.add('iban');
    return PERSONAL_DATA_PLACEHOLDERS.iban;
  });
  text = text.replace(CARD_CANDIDATE_PATTERN, (match) => {
    if (!luhnValid(match)) return match;
    kinds.add('card');
    return PERSONAL_DATA_PLACEHOLDERS.card;
  });
  text = text.replace(PHONE_PATTERN, () => {
    kinds.add('phone');
    return PERSONAL_DATA_PLACEHOLDERS.phone;
  });

  return { text, redacted: kinds.size > 0, kinds: [...kinds] };
}

export function containsPersonalData(value: string): boolean {
  return redactPersonalData(value).redacted;
}

/** True se il testo contiene un segnaposto di redazione, che non deve essere memorizzato. */
export function containsPersonalDataPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value);
}
