export interface BridgeTaskFile {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

export interface BridgeTask {
  id: string;
  workspaceId: string;
  manifestSha256: string;
  state: string;
}

export interface ClaimedBridgeTask {
  task: BridgeTask;
  files: BridgeTaskFile[];
  leaseSecret: string;
}

interface PortalSigningClientBaseOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export type PortalSigningClientOptions = PortalSigningClientBaseOptions &
  (
    | {
        /** Short-lived OIDC access token for the assigned signer. */
        accessToken: string;
        accessTokenProvider?: never;
      }
    | {
        accessToken?: never;
        /** Supplies a fresh short-lived signer token without persisting it in configuration. */
        accessTokenProvider: () => Promise<string>;
      }
  );

export interface ArtifactUpload {
  body: Buffer;
  filename: string;
  mime: string;
  certificateThumbprint: string;
  certificateSubject: string;
  signedAt: Date;
}

export class PortalSigningClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly accessTokenProvider: () => Promise<string>;

  constructor(options: PortalSigningClientOptions) {
    const url = new URL(options.baseUrl);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
      throw new Error('ATLAS Signing Bridge requires HTTPS outside loopback development');
    }
    this.baseUrl = url.toString().replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (options.accessTokenProvider) {
      this.accessTokenProvider = options.accessTokenProvider;
    } else {
      if (!options.accessToken.trim()) throw new Error('Signer OIDC access token is required');
      this.accessTokenProvider = async () => options.accessToken;
    }
  }

  async claim(input: {
    taskId: string;
    pairingSecret: string;
    deviceId: string;
    deviceName: string;
  }): Promise<ClaimedBridgeTask> {
    const response = await this.fetchImpl(`${this.baseUrl}/bid/signing/bridge/claim`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await this.accessToken()}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });
    return this.json<ClaimedBridgeTask>(response, 'claim');
  }

  async downloadFile(
    taskId: string,
    fileId: string,
    leaseSecret: string,
  ): Promise<Buffer> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/bid/signing/bridge/tasks/${taskId}/files/${fileId}`,
      {
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          'x-atlas-signing-lease': leaseSecret,
        },
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok) throw new Error(`Signing file download failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async uploadArtifact(
    taskId: string,
    fileId: string,
    leaseSecret: string,
    artifact: ArtifactUpload,
  ): Promise<unknown> {
    const form = new FormData();
    form.set(
      'file',
      new Blob([new Uint8Array(artifact.body)], { type: artifact.mime }),
      artifact.filename,
    );
    form.set('certificateThumbprint', artifact.certificateThumbprint);
    form.set('certificateSubject', artifact.certificateSubject);
    form.set('signedAt', artifact.signedAt.toISOString());
    const response = await this.fetchImpl(
      `${this.baseUrl}/bid/signing/bridge/tasks/${taskId}/files/${fileId}/artifacts`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          'x-atlas-signing-lease': leaseSecret,
        },
        body: form,
        signal: AbortSignal.timeout(120_000),
      },
    );
    return this.json(response, 'artifact upload');
  }

  private async json<T>(response: Response, operation: string): Promise<T> {
    if (!response.ok) {
      throw new Error(`Signing ${operation} failed: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  private async accessToken(): Promise<string> {
    const token = await this.accessTokenProvider();
    if (!token.trim()) throw new Error('Signer OIDC access token provider returned no token');
    return token;
  }
}
