import { expect, test } from 'vitest';
import { z } from 'zod';

test('rejects oversized collections before parsing every untrusted element', () => {
  let parsedElements = 0;
  const schema = z.array(z.string().superRefine(() => {
    parsedElements += 1;
  })).max(3);

  const result = schema.safeParse(Array.from({ length: 10_000 }, () => 'input'));

  expect(result.success).toBe(false);
  expect(parsedElements).toBe(0);
});
