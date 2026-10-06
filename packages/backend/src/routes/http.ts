import { timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { badRequest } from '../errors.js';

/** A request body: a JSON object whose fields the route checks as it reads them. */
export type Body = Record<string, unknown>;

/** The JSON object the request carries; `{}` without a body. */
export async function readBody(c: Context): Promise<Body> {
  const text = await c.req.text();
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest('invalid_json', 'Ungültiges JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw badRequest('invalid_body', 'Der Inhalt muss ein JSON-Objekt sein');
  }
  return Object.fromEntries(Object.entries(parsed));
}

const invalid = (field: string) => badRequest('invalid_field', `Ungültiger Wert für ${field}`, { field });

/**
 * Typed fields of a request body: undefined when the field is missing, an
 * `invalid_field` error when it has the wrong type. Domain rules (allowed
 * values, lengths) stay with the services.
 */
export const field = {
  string(body: Body, key: string): string | undefined {
    const value = body[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw invalid(key);
    return value;
  },
  /** A string, or null to clear the value. */
  nullableString(body: Body, key: string): string | null | undefined {
    return body[key] === null ? null : field.string(body, key);
  },
  boolean(body: Body, key: string): boolean | undefined {
    const value = body[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') throw invalid(key);
    return value;
  },
  /** A finite number (JSON like 1e400 parses to Infinity, which no store accepts). */
  number(body: Body, key: string): number | undefined {
    const value = body[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(key);
    return value;
  },
  /** A number, or null for "none". */
  nullableNumber(body: Body, key: string): number | null | undefined {
    return body[key] === null ? null : field.number(body, key);
  },
  stringArray(body: Body, key: string): string[] | undefined {
    const value = body[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw invalid(key);
    return value;
  },
};

/** A positive whole-number query parameter, capped at `max`; `fallback` when missing or invalid. */
export function queryLimit(c: Context, key: string, fallback: number, max: number): number {
  return Math.min(max, Math.max(1, Number(c.req.query(key)) || fallback));
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Whether the request body is declared as JSON. Compares the media type itself:
 * browsers send `text/plain` with arbitrary parameters cross-site without a
 * preflight, so a substring match would let such a request through.
 */
export function isJsonRequest(c: Context): boolean {
  const mediaType = (c.req.header('content-type') ?? '').split(';')[0] ?? '';
  return mediaType.trim().toLowerCase() === 'application/json';
}
