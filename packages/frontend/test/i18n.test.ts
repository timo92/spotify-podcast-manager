import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
      const deKeys = flatten(de[ns] as Tree);
      const enKeys = flatten(en[ns] as Tree);
      expect([...enKeys.keys()].sort()).toEqual([...deKeys.keys()].sort());
      for (const [key, text] of deKeys) {
        expect(variables(enKeys.get(key) ?? ''), `${ns}:${key}`).toEqual(variables(text));
        expect(text.trim(), `${ns}:${key} (de) is empty`).not.toBe('');
        expect(enKeys.get(key)?.trim(), `${ns}:${key} (en) is empty`).not.toBe('');
      }
    });
  }

  it('cover every error code the API returns', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk(join(__dirname, '../../backend/src'));
    const codes = new Set<string>(['unauthorized', 'internal']);
    const patterns = [/new ApiError\(\s*[\w.]+,\s*'(\w+)'/g, /(?:badRequest|notFound)\(\s*'(\w+)'/g, /error: '(\w+)'/g];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const re of patterns) for (const m of source.matchAll(re)) codes.add(m[1]);
    }
    const translated = Object.keys(de.errors);
    expect([...codes].filter((c) => !translated.includes(c))).toEqual([]);
  });
});
