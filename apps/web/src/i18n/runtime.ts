import { useSyncExternalStore } from 'react';
import {
  translate,
  translateMessage,
  type Locale,
  type TranslationValues,
} from '@myteam/contracts';

export const localeStorageKey = 'myteam.locale';
const listeners = new Set<() => void>();
const validLocale = (value: unknown): value is Locale => value === 'zh-CN' || value === 'en-US';
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(localeStorageKey);
    return validLocale(stored) ? stored : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}
let locale: Locale = initialLocale();
export const getLocale = () => locale;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useLocale = () => useSyncExternalStore(subscribe, getLocale, () => 'zh-CN' as Locale);

export function setLocale(next: Locale) {
  if (!validLocale(next)) return;
  try {
    localStorage.setItem(localeStorageKey, next);
  } catch {
    // Language switching still works when browser storage is unavailable.
  }
  if (locale === next) return;
  locale = next;
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== localeStorageKey && event.key !== null) return;
    const next = validLocale(event.newValue) ? event.newValue : 'zh-CN';
    if (next === locale) return;
    locale = next;
    listeners.forEach((listener) => listener());
  });
}

export function t(text: string, values?: TranslationValues) {
  return values ? translate(text, locale, values) : translateMessage(text, locale);
}

// Keep module-level label maps reactive without translating API values or user content.
export function localizeLabels<T extends Record<string, string>>(
  labels: T,
): { [K in keyof T]: string } {
  return Object.defineProperties(
    {} as { [K in keyof T]: string },
    Object.fromEntries(
      Object.entries(labels).map(([key, value]) => [
        key,
        { enumerable: true, get: () => t(value) },
      ]),
    ),
  );
}
