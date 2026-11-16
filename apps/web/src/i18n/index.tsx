import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { en } from './en';
import { fr } from './fr';

export type Language = 'it' | 'en' | 'fr';
export const LANGUAGE_STORAGE_KEY = 'memora-language';
export const SUPPORTED_LANGUAGES: Array<{ id: Language; label: string; short: string }> = [
  { id: 'it', label: 'Italiano', short: 'IT' },
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'fr', label: 'Français', short: 'FR' },
];
const DICTIONARIES: Partial<Record<Language, Record<string, string>>> = { en, fr };

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (source: string, values?: Record<string, string | number>) => string;
}

function detectLanguage(): Language {
  if (typeof window === 'undefined') return 'it';
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === 'it' || stored === 'en' || stored === 'fr') return stored;
  const browser = (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase();
  if (browser.startsWith('it')) return 'it';
  if (browser.startsWith('fr')) return 'fr';
  return 'en';
}

const fallbackT = (source: string, values?: Record<string, string | number>) => interpolate(source, values);
const fallback: I18nContextValue = { language: 'it', setLanguage: () => undefined, t: fallbackT };
const I18nContext = createContext<I18nContextValue>(fallback);

function interpolate(source: string, values?: Record<string, string | number>): string {
  if (!values) return source;
  return source.replace(/\{(\w+)\}/g, (match, key: string) => Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => detectLanguage());
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* storage unavailable */ }
    document.documentElement.lang = next;
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const t = useCallback((source: string, values?: Record<string, string | number>) => {
    const dictionary = DICTIONARIES[language];
    return interpolate(dictionary?.[source] ?? source, values);
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = useI18n();
  return (
    <select
      className={compact ? 'language-select is-compact' : 'language-select'}
      value={language}
      onChange={event => setLanguage(event.target.value as Language)}
      aria-label="Lingua / Language / Langue"
      title="Lingua / Language / Langue"
    >
      {SUPPORTED_LANGUAGES.map(item => <option key={item.id} value={item.id}>{compact ? item.short : item.label}</option>)}
    </select>
  );
}
