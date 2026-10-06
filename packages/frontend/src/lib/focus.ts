const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements inside `root` that Tab reaches, in order. */
export function focusableIn(root: HTMLElement | null): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
}

/**
 * The item the arrow keys, Home or End move to from `current` (wrapping
 * around), or undefined for any other key.
 */
export function itemForKey<T>(items: T[], current: T | null, key: string): T | undefined {
  // Without a current item, the next one is the first and the previous one the last.
  const i = current === null ? -1 : items.indexOf(current);
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return items[(i + 1) % items.length];
    case 'ArrowUp':
    case 'ArrowLeft':
      return items[(Math.max(i, 0) - 1 + items.length) % items.length];
    case 'Home':
      return items[0];
    case 'End':
      return items[items.length - 1];
    default:
      return undefined;
  }
}
