import { useSyncExternalStore } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type FontSizePreference = 'small' | 'normal' | 'large' | 'xlarge';
export type DensityPreference = 'comfortable' | 'compact';

export interface AppearanceSettings {
  theme: ThemeMode;
  fontSize: FontSizePreference;
  density: DensityPreference;
  wideChat: boolean;
  reducedMotion: boolean;
  sidebarCollapsed: boolean;
}

export interface AppearanceUpdate extends Partial<AppearanceSettings> {}

export const APPEARANCE_STORAGE_KEY = 'memora-appearance';

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'system',
  fontSize: 'normal',
  density: 'comfortable',
  wideChat: false,
  reducedMotion: false,
  sidebarCollapsed: false,
};

const THEMES: ThemeMode[] = ['system', 'light', 'dark'];
const FONT_SIZES: FontSizePreference[] = ['small', 'normal', 'large', 'xlarge'];
const DENSITIES: DensityPreference[] = ['comfortable', 'compact'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

export function normalizeAppearance(value: unknown): AppearanceSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_APPEARANCE };
  const candidate = value as Record<string, unknown>;
  return {
    theme: oneOf(candidate.theme, THEMES, DEFAULT_APPEARANCE.theme),
    fontSize: oneOf(candidate.fontSize, FONT_SIZES, DEFAULT_APPEARANCE.fontSize),
    density: oneOf(candidate.density, DENSITIES, DEFAULT_APPEARANCE.density),
    wideChat: typeof candidate.wideChat === 'boolean' ? candidate.wideChat : DEFAULT_APPEARANCE.wideChat,
    reducedMotion: typeof candidate.reducedMotion === 'boolean' ? candidate.reducedMotion : DEFAULT_APPEARANCE.reducedMotion,
    sidebarCollapsed: typeof candidate.sidebarCollapsed === 'boolean' ? candidate.sidebarCollapsed : DEFAULT_APPEARANCE.sidebarCollapsed,
  };
}

export function resolveTheme(theme: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

function readStoredAppearance(): AppearanceSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_APPEARANCE };
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return raw ? normalizeAppearance(JSON.parse(raw)) : { ...DEFAULT_APPEARANCE };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

let current = readStoredAppearance();
const listeners = new Set<() => void>();
let systemThemeBound = false;

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export function applyAppearance(settings: AppearanceSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(settings.theme, systemPrefersDark());
  root.dataset.themeMode = settings.theme;
  root.dataset.fontSize = settings.fontSize;
  root.dataset.density = settings.density;
  root.dataset.chatWidth = settings.wideChat ? 'wide' : 'standard';
  root.dataset.reducedMotion = settings.reducedMotion ? 'true' : 'false';
}

function bindSystemTheme(): void {
  if (systemThemeBound || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  systemThemeBound = true;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (current.theme === 'system') applyAppearance(current);
  });
}

export function initAppearance(): void {
  bindSystemTheme();
  applyAppearance(current);
}

export function getAppearance(): AppearanceSettings {
  return current;
}

export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateAppearance(patch: AppearanceUpdate): AppearanceSettings {
  current = normalizeAppearance({ ...current, ...patch });
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(current));
    } catch {
      // La preferenza resta valida per la sessione corrente.
    }
  }
  applyAppearance(current);
  listeners.forEach(listener => listener());
  return current;
}

export function resetAppearance(): AppearanceSettings {
  return updateAppearance(DEFAULT_APPEARANCE);
}

export function useAppearance(): AppearanceSettings {
  return useSyncExternalStore(subscribeAppearance, getAppearance, () => DEFAULT_APPEARANCE);
}
