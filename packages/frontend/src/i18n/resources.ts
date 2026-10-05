import deCommon from '../locales/de/common.json';
import deErrors from '../locales/de/errors.json';
import enCommon from '../locales/en/common.json';
import enErrors from '../locales/en/errors.json';

/** All translations, one namespace per area; `de` defines the keys (see i18next.d.ts). */
export const resources = {
  de: { common: deCommon, errors: deErrors },
  en: { common: enCommon, errors: enErrors },
} as const;
