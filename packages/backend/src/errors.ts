import { StatusCodes } from 'http-status-codes';

/** Error that is rendered as a JSON response with the given status. */
export class ApiError extends Error {
  constructor(
    readonly status: StatusCodes,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new ApiError(StatusCodes.BAD_REQUEST, 'bad_request', message);
export const notFound = (message = 'Nicht gefunden') => new ApiError(StatusCodes.NOT_FOUND, 'not_found', message);
export const unauthorized = (message = 'Nicht angemeldet') =>
  new ApiError(StatusCodes.UNAUTHORIZED, 'unauthorized', message);
