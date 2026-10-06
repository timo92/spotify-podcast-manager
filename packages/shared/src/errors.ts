/**
 * Every error code the API returns, with the parameters it sends along. The
 * frontend translates each code (frontend/src/locales/<lang>/errors.json);
 * codes without parameters map to `undefined`.
 */
export interface ErrorParams {
  internal: undefined;
  invalid_json: undefined;
  invalid_body: undefined;
  invalid_field: { field: string };
  unsupported_media_type: undefined;
  unauthorized: undefined;
  origin_forbidden: undefined;
  not_found: undefined;
  show_not_found: undefined;
  episode_not_found: undefined;
  episode_required: undefined;
  weekdays_required: undefined;
  invalid_weekday: undefined;
  invalid_schedule: undefined;
  too_many_rules: { max: number };
  rule_show_missing: undefined;
  schedule_conflict: undefined;
  invalid_note: undefined;
  note_too_long: { max: number };
  invalid_note_position: undefined;
  note_not_found: undefined;
  invalid_mode: undefined;
  invalid_status: undefined;
  not_configured: { detail: string };
  sync_start_failed: undefined;
  sync_interrupted: undefined;
  sync_running: undefined;
  no_active_device: undefined;
  device_unavailable: undefined;
  spotify_user_not_allowed: undefined;
  spotify_not_connected: undefined;
  spotify_reauth: { detail: string };
  spotify_invalid_client: { detail: string };
  spotify_token_error: { detail: string };
  spotify_rate_limited: { minutes: number };
  spotify_forbidden: { detail: string };
  spotify_error: { status: number; detail: string };
  spotify_unavailable: undefined;
  spotify_unexpected_response: { detail: string };
}

export type ErrorCode = keyof ErrorParams;

type ParamKeys<C extends ErrorCode> = ErrorParams[C] extends undefined ? never : keyof ErrorParams[C];

/** The parameter names of every code, at runtime: lets tests compare them with the translations. */
export const ERROR_PARAMS = {
  internal: [],
  invalid_json: [],
  invalid_body: [],
  invalid_field: ['field'],
  unsupported_media_type: [],
  unauthorized: [],
  origin_forbidden: [],
  not_found: [],
  show_not_found: [],
  episode_not_found: [],
  episode_required: [],
  weekdays_required: [],
  invalid_weekday: [],
  invalid_schedule: [],
  too_many_rules: ['max'],
  rule_show_missing: [],
  schedule_conflict: [],
  invalid_note: [],
  note_too_long: ['max'],
  invalid_note_position: [],
  note_not_found: [],
  invalid_mode: [],
  invalid_status: [],
  not_configured: ['detail'],
  sync_start_failed: [],
  sync_interrupted: [],
  sync_running: [],
  no_active_device: [],
  device_unavailable: [],
  spotify_user_not_allowed: [],
  spotify_not_connected: [],
  spotify_reauth: ['detail'],
  spotify_invalid_client: ['detail'],
  spotify_token_error: ['detail'],
  spotify_rate_limited: ['minutes'],
  spotify_forbidden: ['detail'],
  spotify_error: ['status', 'detail'],
  spotify_unavailable: [],
  spotify_unexpected_response: ['detail'],
} as const satisfies { [C in ErrorCode]: readonly ParamKeys<C>[] };

type UnlistedParams = {
  [C in ErrorCode]: Exclude<ParamKeys<C>, (typeof ERROR_PARAMS)[C][number]>;
}[ErrorCode];
// Fails to compile when ERROR_PARAMS leaves out a parameter of ErrorParams.
true satisfies [UnlistedParams] extends [never] ? true : never;

/**
 * Codes the OAuth callback sends to the login page (`/login?error=<code>`)
 * that it explains: its own, Spotify's OAuth errors and the API errors a login
 * can end with. Other codes are shown as a generic failure.
 */
export type LoginErrorCode =
  | Extract<ErrorCode, 'not_configured' | 'spotify_invalid_client' | 'spotify_user_not_allowed'>
  | 'access_denied'
  | 'invalid_client'
  | 'state_mismatch'
  | 'wrong_account'
  | 'token_exchange_failed'
  | 'login_failed';
