import { WindowsCertificateStoreDriver } from './windows-certificate-store.driver';

async function main(): Promise<void> {
  const inspection = await new WindowsCertificateStoreDriver().inspect();
  process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
