import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import i18n from '../../src/i18n';

// Tests read the German UI; every API call a test doesn't mock fails loudly
// instead of hitting the network.
beforeEach(async () => {
  await i18n.changeLanguage('de');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unmocked request in a component test: ${String(input)}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
