export interface LeaseAwareResponse {
  destroyed?: boolean;
  writableEnded?: boolean;
  once(event: 'finish' | 'close', listener: () => void): void;
  off(event: 'finish' | 'close', listener: () => void): void;
}

/** Keeps a memory lease alive for the lifetime of the HTTP payload, including
 * slow clients. Closed responses are detected both before and after listener
 * registration because EventEmitter does not replay an earlier close event. */
export function releaseLeaseOnResponseEnd(
  response: LeaseAwareResponse,
  release: () => void,
  signal?: AbortSignal,
): void {
  let settled = false;
  const onEnd = () => {
    if (settled) return;
    settled = true;
    response.off('finish', onEnd);
    response.off('close', onEnd);
    release();
  };
  if (signal?.aborted || response.destroyed || response.writableEnded) {
    onEnd();
    return;
  }
  response.once('finish', onEnd);
  response.once('close', onEnd);
  if (signal?.aborted || response.destroyed || response.writableEnded) onEnd();
}
