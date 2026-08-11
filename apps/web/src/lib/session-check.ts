interface BlockingCheckResult {
  blocking: boolean;
  requestId: number;
  latestBlockingRequestId: number;
  usable: boolean;
}

export function shouldReleaseBlockingSessionCheck({
  blocking,
  requestId,
  latestBlockingRequestId,
  usable,
}: BlockingCheckResult): boolean {
  return blocking && usable && requestId === latestBlockingRequestId;
}
