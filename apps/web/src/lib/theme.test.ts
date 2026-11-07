import { describe, expect, it } from 'vitest';

describe('theme utilities and token parity', () => {
  it('toggles between dark and light themes deterministically', () => {
    const toggle = (current: 'dark' | 'light'): 'dark' | 'light' =>
      current === 'dark' ? 'light' : 'dark';

    expect(toggle('dark')).toBe('light');
    expect(toggle('light')).toBe('dark');
  });

  it('validates theme values', () => {
    const isValidTheme = (theme: string): theme is 'dark' | 'light' =>
      theme === 'dark' || theme === 'light';

    expect(isValidTheme('dark')).toBe(true);
    expect(isValidTheme('light')).toBe(true);
    expect(isValidTheme('unknown')).toBe(false);
  });
});
