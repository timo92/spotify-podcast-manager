import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readStored, writeStored } from '../lib/storage';
import { resources } from './resources';

export const LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = 'pm.lang';

const isLanguage = (value: unknown): value is Language => LANGUAGES.includes(value as Language);

/** The language chosen in the settings, or undefined to follow the browser. */
export function storedLanguage(): Language | undefined {
  const value = readStored(STORAGE_KEY);
  return isLanguage(value) ? value : undefined;
}

/** The first browser language the app supports; English for any other. */
export function browserLanguage(): Language {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const lang = tag.slice(0, 2).toLowerCase();
    if (isLanguage(lang)) return lang;
  }
  return 'en';
}

/** Switches the language and remembers the choice in this browser; undefined follows the browser again. */
export function setLanguage(lang: Language | undefined) {
  writeStored(STORAGE_KEY, lang);
  void i18n.changeLanguage(lang ?? browserLanguage());
}

/**
 * Locale for Intl formatting: the browser's own tag when it is in the active
 * language (so en-GB and en-US keep their date order), else the language.
 */
export function formatLocale(): string {
  const lang = i18n.language;
  return (navigator.languages ?? [navigator.language]).find((tag) => tag.slice(0, 2).toLowerCase() === lang) ?? lang;
}

i18n.on('languageChanged', (lang) => {
  document.documentElement.lang = lang;
});

void i18n.use(initReactI18next).init({
  resources,
  lng: storedLanguage() ?? browserLanguage(),
  fallbackLng: 'de',
  supportedLngs: LANGUAGES,
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  initAsync: false,
});

export default i18n;
