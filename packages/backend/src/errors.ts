import { StatusCodes } from 'http-status-codes';
import type { ErrorCode, ErrorParams } from '@podcast/shared';

/** The parameters argument of an error code: required when the code has parameters, absent otherwise. */
type ParamsArg<C extends ErrorCode> = ErrorParams[C] extends undefined ? [] : [params: ErrorParams[C]];

/**
 * Error that is rendered as a JSON response with the given status. `code` is
 * stable and translated by the client (with `params`, see ErrorParams in
 * shared); `message` is a German fallback, also for logs.
 */
export class ApiError<C extends ErrorCode = ErrorCode> extends Error {
  readonly params?: ErrorParams[C];

  constructor(
    readonly status: StatusCodes,
    readonly code: C,
    message: string,
    ...[params]: ParamsArg<C>
  ) {
    super(message);
    this.params = params;
  }
}

export const badRequest = <C extends ErrorCode>(code: C, message: string, ...params: ParamsArg<C>) =>
  new ApiError(StatusCodes.BAD_REQUEST, code, message, ...params);
export const notFound = (
  code: 'not_found' | 'show_not_found' | 'episode_not_found' | 'note_not_found' = 'not_found',
  message = 'Nicht gefunden',
) => new ApiError(StatusCodes.NOT_FOUND, code, message);
/** A listed Spotify Connect device that Spotify can't reach (e.g. a suspended phone app). Kept at 404. */
export const deviceUnavailable = () =>
  new ApiError(
    StatusCodes.NOT_FOUND,
    'device_unavailable',
    'Das Gerät ist bei Spotify gerade nicht erreichbar. Öffne Spotify dort und versuche es erneut.',
  );
export const unauthorized = (message = 'Nicht angemeldet') =>
  new ApiError(StatusCodes.UNAUTHORIZED, 'unauthorized', message);
