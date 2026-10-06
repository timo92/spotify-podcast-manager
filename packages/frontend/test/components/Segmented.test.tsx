import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Segmented } from '../../src/components/ui';

function Choice() {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('b');
  const options = [
    { value: 'a' as const, label: 'Morgens' },
    { value: 'b' as const, label: 'Mittags' },
    { value: 'c' as const, label: 'Abends' },
  ];
  return (
    <>
      <button type="button">Vorher</button>
      <Segmented label="Tageszeit" value={value} options={options} onChange={setValue} />
    </>
  );
}

describe('Segmented', () => {
  it('is reached by Tab on the chosen option and changed with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Choice />);
    await user.click(screen.getByRole('button', { name: 'Vorher' }));
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Mittags' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    const evening = screen.getByRole('radio', { name: 'Abends' });
    expect(evening).toHaveFocus();
    expect(evening).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Morgens' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(evening).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Vorher' })).toHaveFocus();
  });
});
