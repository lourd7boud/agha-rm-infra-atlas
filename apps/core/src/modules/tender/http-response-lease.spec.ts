import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'vitest';
import {
  releaseLeaseOnResponseEnd,
  type LeaseAwareResponse,
} from './http-response-lease';

class FakeResponse extends EventEmitter implements LeaseAwareResponse {
  destroyed = false;
  writableEnded = false;
}

describe('releaseLeaseOnResponseEnd', () => {
  test('releases immediately when close happened before lease binding', () => {
    const response = new FakeResponse();
    response.destroyed = true;
    let releases = 0;

    releaseLeaseOnResponseEnd(response, () => {
      releases += 1;
    });
    response.emit('close');

    expect(releases).toBe(1);
  });

  test('releases once on finish or close and removes both listeners', () => {
    const response = new FakeResponse();
    let releases = 0;
    releaseLeaseOnResponseEnd(response, () => {
      releases += 1;
    });

    response.emit('finish');
    response.emit('close');

    expect(releases).toBe(1);
    expect(response.listenerCount('finish')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  test('releases immediately for an already-aborted request', () => {
    const response = new FakeResponse();
    const abort = new AbortController();
    abort.abort();
    let releases = 0;

    releaseLeaseOnResponseEnd(response, () => {
      releases += 1;
    }, abort.signal);

    expect(releases).toBe(1);
  });
});
