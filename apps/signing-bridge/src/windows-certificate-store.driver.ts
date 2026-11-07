import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  DriverInspection,
  LocalSigningDriver,
  LocalSigningInput,
  LocalSigningOutput,
} from './driver';

const execFileAsync = promisify(execFile);

type CommandRunner = (
  executable: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: CommandRunner = async (executable, args) => {
  const result = await execFileAsync(executable, [...args], {
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

interface WindowsCertificateRow {
  Thumbprint?: string;
  Subject?: string;
  Issuer?: string;
  NotBefore?: string;
  NotAfter?: string;
  HasPrivateKey?: boolean;
}

export class WindowsCertificateStoreDriver implements LocalSigningDriver {
  readonly id = 'windows-certificate-store-diagnostic';

  constructor(private readonly run: CommandRunner = defaultRunner) {}

  async inspect(): Promise<DriverInspection> {
    if (process.platform !== 'win32' && this.run === defaultRunner) {
      return {
        available: false,
        certificates: [],
        message: 'Windows certificate store is available only on Windows',
      };
    }
    const script =
      "$ErrorActionPreference='Stop'; " +
      'Get-ChildItem -Path Cert:\\CurrentUser\\My | ' +
      'Select-Object Thumbprint,Subject,Issuer,NotBefore,NotAfter,HasPrivateKey | ' +
      'ConvertTo-Json -Compress';
    const { stdout } = await this.run('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    const parsed = stdout.trim() ? (JSON.parse(stdout) as WindowsCertificateRow | WindowsCertificateRow[]) : [];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const certificates = rows
      .filter((row) => row.HasPrivateKey && row.Thumbprint && row.Subject)
      .map((row) => ({
        thumbprint: row.Thumbprint!.replace(/\s+/g, '').toLowerCase(),
        subject: row.Subject!,
        ...(row.Issuer ? { issuer: row.Issuer } : {}),
        ...(row.NotBefore ? { notBefore: new Date(row.NotBefore) } : {}),
        ...(row.NotAfter ? { notAfter: new Date(row.NotAfter) } : {}),
      }));
    return { available: true, certificates };
  }

  async sign(_input: LocalSigningInput): Promise<LocalSigningOutput> {
    throw new Error(
      'No validated vendor signing adapter is configured; diagnostics cannot sign',
    );
  }
}
