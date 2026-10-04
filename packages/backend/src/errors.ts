/** Error that is rendered as a JSON response with the given status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new ApiError(400, 'bad_request', message);
export const notFound = (message = 'Nicht gefunden') => new ApiError(404, 'not_found', message);
export const unauthorized = (message = 'Nicht angemeldet') => new ApiError(401, 'unauthorized', message);
