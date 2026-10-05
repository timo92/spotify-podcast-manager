import type { ErrorCode, LoginErrorCode } from '@podcast/shared';
import deAuth from '../locales/de/auth.json';
import deCommon from '../locales/de/common.json';
import deEpisode from '../locales/de/episode.json';
import deErrors from '../locales/de/errors.json';
import deHistory from '../locales/de/history.json';
import dePlan from '../locales/de/plan.json';
import dePlayer from '../locales/de/player.json';
import deSettings from '../locales/de/settings.json';
import deShows from '../locales/de/shows.json';
import deToday from '../locales/de/today.json';
import enAuth from '../locales/en/auth.json';
import enCommon from '../locales/en/common.json';
import enEpisode from '../locales/en/episode.json';
import enErrors from '../locales/en/errors.json';
import enHistory from '../locales/en/history.json';
import enPlan from '../locales/en/plan.json';
import enPlayer from '../locales/en/player.json';
import enSettings from '../locales/en/settings.json';
import enShows from '../locales/en/shows.json';
import enToday from '../locales/en/today.json';

/** Every API error code has a text (plus `http` for responses without a code). */
type ErrorTexts = Record<ErrorCode | 'http', string>;
/** The login page explains every code the OAuth callback sends it. */
type AuthTexts = { error: Record<LoginErrorCode, string> };

/** All translations, one namespace per area; `de` defines the keys (see i18next.d.ts). */
export const resources = {
  de: {
    auth: deAuth satisfies AuthTexts,
    common: deCommon,
    episode: deEpisode,
    errors: deErrors satisfies ErrorTexts,
    history: deHistory,
    plan: dePlan,
    player: dePlayer,
    settings: deSettings,
    shows: deShows,
    today: deToday,
  },
  en: {
    auth: enAuth satisfies AuthTexts,
    common: enCommon,
    episode: enEpisode,
    errors: enErrors satisfies ErrorTexts,
    history: enHistory,
    plan: enPlan,
    player: enPlayer,
    settings: enSettings,
    shows: enShows,
    today: enToday,
  },
} as const;
