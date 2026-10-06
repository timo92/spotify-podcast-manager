// localStorage holds per-browser choices only. A browser may refuse it
// (private mode, disabled storage): reads then find nothing and writes are
// dropped, so the app falls back to its defaults.

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The stored JSON value, or undefined when there is none or it doesn't parse. */
export function readStoredJson(key: string): unknown {
  const raw = readStored(key);
  try {
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/** Stores `value`; undefined removes the key. */
export function writeStored(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // not available: the choice just isn't remembered
  }
}
