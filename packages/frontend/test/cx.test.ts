import { describe, expect, it } from 'vitest';
import { cx } from '../src/lib/cx';

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('a', false, 'b', null, undefined, '')).toBe('a b');
    expect(cx()).toBe('');
  });
});
