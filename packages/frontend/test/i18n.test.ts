import { describe, expect, it } from 'vitest';
import { ERROR_PARAMS } from '@podcast/shared';
import { resources } from '../src/i18n/resources';

type Tree = { [key: string]: string | Tree };

/** "a.b.c" → value, for every string leaf. */
function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const variables = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  const { de, en } = resources;

  it('have the same namespaces', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
  });

  for (const ns of Object.keys(de) as (keyof typeof de)[]) {
    it(`"${ns}" has every key in both languages, with the same variables`, () => {
      const deKeys = flatten(de[ns]);
      const enKeys = flatten(en[ns]);
      expect([...enKeys.keys()].sort()).toEqual([...deKeys.keys()].sort());
      for (const [key, text] of deKeys) {
        expect(variables(enKeys.get(key) ?? ''), `${ns}:${key}`).toEqual(variables(text));
        expect(text.trim(), `${ns}:${key} (de) is empty`).not.toBe('');
        expect(enKeys.get(key)?.trim(), `${ns}:${key} (en) is empty`).not.toBe('');
      }
    });
  }

  it('translate every API error code with exactly its parameters', () => {
    for (const lang of [de, en]) {
      const texts: Record<string, string> = lang.errors;
      expect(Object.keys(texts).sort()).toEqual([...Object.keys(ERROR_PARAMS), 'http'].sort());
      for (const [code, params] of Object.entries(ERROR_PARAMS)) {
        expect(variables(texts[code]), code).toEqual([...params].sort());
      }
    }
  });
});
