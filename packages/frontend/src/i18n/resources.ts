import deCommon from '../locales/de/common.json';
import deEpisode from '../locales/de/episode.json';
import deErrors from '../locales/de/errors.json';
import dePlan from '../locales/de/plan.json';
import dePlayer from '../locales/de/player.json';
import enCommon from '../locales/en/common.json';
import enEpisode from '../locales/en/episode.json';
import enErrors from '../locales/en/errors.json';
import enPlan from '../locales/en/plan.json';
import enPlayer from '../locales/en/player.json';

/** All translations, one namespace per area; `de` defines the keys (see i18next.d.ts). */
export const resources = {
  de: { common: deCommon, episode: deEpisode, errors: deErrors, plan: dePlan, player: dePlayer },
  en: { common: enCommon, episode: enEpisode, errors: enErrors, plan: enPlan, player: enPlayer },
} as const;
