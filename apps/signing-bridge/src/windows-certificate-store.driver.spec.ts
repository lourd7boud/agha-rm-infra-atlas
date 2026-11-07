import { describe, expect, it, vi } from 'vitest';
import { WindowsCertificateStoreDriver } from './windows-certificate-store.driver';

describe('WindowsCertificateStoreDriver diagnostics', () => {
  it('lists only certificates backed by a private key without requesting a PIN', async () => {
    const run = vi.fn(async () => ({
      stdout: JSON.stringify([
        {
          Thumbprint: 'AABB',
          Subject: 'CN=AGHID CONSTRUCTION',
          Issuer: 'CN=Barid eSign',
          NotBefore: '2026-01-01T00:00:00Z',
          NotAfter: '2027-01-01T00:00:00Z',
          HasPrivateKey: true,
        },
        {
          Thumbprint: 'CCDD',
          Subject: 'CN=Public only',
          HasPrivateKey: false,
        },
      ]),
      stderr: '',
    }));
    const driver = new WindowsCertificateStoreDriver(run);

    const inspection = await driver.inspect();

    expect(inspection.available).toBe(true);
    expect(inspection.certificates).toHaveLength(1);
    expect(inspection.certificates[0]).toMatchObject({
      thumbprint: 'aabb',
      subject: 'CN=AGHID CONSTRUCTION',
      issuer: 'CN=Barid eSign',
    });
    expect(JSON.stringify(run.mock.calls)).not.toMatch(/pin|password/i);
  });

  it('refuses to pretend it can sign before a validated vendor adapter exists', async () => {
    const driver = new WindowsCertificateStoreDriver(async () => ({
      stdout: '[]',
      stderr: '',
    }));
    await expect(
      driver.sign({
        taskId: 'task',
        manifestSha256: 'a'.repeat(64),
        fileId: 'file',
        filename: 'acte.pdf',
        mime: 'application/pdf',
        body: Buffer.from('pdf'),
      }),
    ).rejects.toThrow(/vendor signing adapter/i);
  });
});
