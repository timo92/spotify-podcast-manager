export interface HttpRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  cookies: Record<string, string>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** Raw Set-Cookie values. */
  cookies?: string[];
}

export function json(body: unknown, status = 200): HttpResponse {
  return { status, body };
}

export function redirect(location: string, cookies: string[] = []): HttpResponse {
  return { status: 302, headers: { Location: location }, cookies };
}

export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = Array.isArray(header) ? header : (header ?? '').split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge?: number; secure: boolean; path?: string },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`, 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}
