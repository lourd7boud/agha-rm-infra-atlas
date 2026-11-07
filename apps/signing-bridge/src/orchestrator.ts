import { createHash } from 'node:crypto';
import type { LocalSigningDriver } from './driver';
import type { BridgeTaskFile, PortalSigningClient } from './portal-client';

export interface RunSigningTaskOptions {
  client: PortalSigningClient;
  driver: LocalSigningDriver;
  taskId: string;
  pairingSecret: string;
  deviceId: string;
  deviceName: string;
  confirmManifest: (
    manifestSha256: string,
    files: readonly BridgeTaskFile[],
  ) => Promise<boolean>;
}

export async function runSigningTask(options: RunSigningTaskOptions): Promise<{
  taskId: string;
  stagedArtifacts: number;
}> {
  const claimed = await options.client.claim({
    taskId: options.taskId,
    pairingSecret: options.pairingSecret,
    deviceId: options.deviceId,
    deviceName: options.deviceName,
  });
  const confirmed = await options.confirmManifest(
    claimed.task.manifestSha256,
    claimed.files,
  );
  if (!confirmed) throw new Error('Human signer rejected the manifest');

  let stagedArtifacts = 0;
  for (const file of claimed.files) {
    const body = await options.client.downloadFile(
      claimed.task.id,
      file.id,
      claimed.leaseSecret,
    );
    if (body.length !== file.sizeBytes) {
      throw new Error(`Signing input size mismatch for ${file.filename}`);
    }
    const digest = createHash('sha256').update(body).digest('hex');
    if (digest !== file.sha256) {
      throw new Error(`Signing input hash mismatch for ${file.filename}`);
    }
    const signed = await options.driver.sign({
      taskId: claimed.task.id,
      manifestSha256: claimed.task.manifestSha256,
      fileId: file.id,
      filename: file.filename,
      mime: file.mime,
      body,
    });
    const signedDigest = createHash('sha256').update(signed.body).digest('hex');
    if (signedDigest === digest) {
      throw new Error(`Token driver returned unchanged bytes for ${file.filename}`);
    }
    await options.client.uploadArtifact(
      claimed.task.id,
      file.id,
      claimed.leaseSecret,
      signed,
    );
    stagedArtifacts += 1;
  }
  return { taskId: claimed.task.id, stagedArtifacts };
}
