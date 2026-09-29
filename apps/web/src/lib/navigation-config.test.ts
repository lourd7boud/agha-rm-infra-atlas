import { describe, expect, test } from 'vitest';
import nextConfig from '../../next.config';

describe('legacy company document navigation', () => {
  test('permanently redirects the retired vault page to Statut légal & docs', async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toContainEqual({
      source: '/vault',
      destination: '/compta/legal',
      permanent: true,
    });
  });
});
