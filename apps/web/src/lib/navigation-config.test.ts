import { describe, expect, test } from 'vitest';
import nextConfig from '../../next.config';
import { readFileSync } from 'node:fs';

describe('legacy company document navigation', () => {
  test('contains one explicit accounting review destination', () => {
    const source = readFileSync(new URL('../components/nav/RailNav.tsx', import.meta.url), 'utf8');
    expect(source.match(/href: '\/compta\/a-valider'/g)).toHaveLength(1);
  });
  test('permanently redirects the retired vault page to Statut légal & docs', async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toContainEqual({
      source: '/vault',
      destination: '/compta/legal',
      permanent: true,
    });
  });
});
