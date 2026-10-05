import { describe, expect, it } from 'vitest';
import i18n from '../src/i18n';
import { errorMessage } from '../src/lib/api';

describe('errorMessage', () => {
  it('translates known codes with their parameters', async () => {
    const body = { error: 'too_many_rules', message: 'Höchstens 200 Regeln', params: { max: 200 } };
    expect(errorMessage(body, 400)).toBe('Höchstens 200 Regeln im Wochenplan.');
    await i18n.changeLanguage('en');
    expect(errorMessage(body, 400)).toBe('At most 200 rules in the weekly plan.');
  });

  it("keeps the server's message for unknown codes, or names the status", () => {
    expect(errorMessage({ error: 'something_new', message: 'Neu' }, 400)).toBe('Neu');
    expect(errorMessage(undefined, 502)).toBe('Fehler 502');
  });
});
