import { readStored, writeStored } from './storage';

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'pm.theme';

/** The theme chosen in this browser; 'system' follows the operating system. */
export function storedTheme(): Theme {
  const theme = readStored(KEY);
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

/** Shows `theme` and remembers it in this browser. */
export function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  writeStored(KEY, theme === 'system' ? undefined : theme);
}
