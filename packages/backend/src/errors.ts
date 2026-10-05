import { StatusCodes } from 'http-status-codes';

/** Values the client inserts into its translation of an error code, e.g. `{ max: 200 }`. */
export type ErrorParams = Record<string, string | number>;

/**
 * Error that is rendered as a JSON response with the given status. `code` is
 * stable and translated by the client (with `params`); `message` is a German
 * fallback, also for logs.
 */
export class ApiError extends Error {
  constructor(
    readonly status: StatusCodes,
    readonly code: string,
    message: string,
    readonly params?: ErrorParams,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, params?: ErrorParams) =>
  new ApiError(StatusCodes.BAD_REQUEST, code, message, params);
export const notFound = (code = 'not_found', message = 'Nicht gefunden') =>
  new ApiError(StatusCodes.NOT_FOUND, code, message);
export const unauthorized = (message = 'Nicht angemeldet') =>
  new ApiError(StatusCodes.UNAUTHORIZED, 'unauthorized', message);
