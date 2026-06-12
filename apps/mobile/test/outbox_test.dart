import 'package:flutter_test/flutter_test.dart';

import 'package:atlas_mobile/sync/outbox.dart';

class FakeTransport implements ReportTransport {
  FakeTransport({this.failing = false});

  bool failing;
  final sent = <PendingReport>[];

  @override
  Future<void> send(PendingReport report) async {
    if (failing) {
      throw Exception('zone blanche');
    }
    sent.add(report);
  }
}

PendingReport report(String works) => PendingReport(
      projectId: 'p-1',
      reportDate: DateTime.utc(2026, 6, 12),
      effectifs: 14,
      travauxRealises: works,
    );

void main() {
  test('online submit sends immediately and queues nothing', () async {
    final transport = FakeTransport();
    final outbox = ReportOutbox(transport);

    final status = await outbox.submit(report('Coulage semelles'));

    expect(status, SyncStatus.sent);
    expect(transport.sent, hasLength(1));
    expect(outbox.pending, isEmpty);
  });

  test('dead zone queues the report instead of losing it', () async {
    final transport = FakeTransport(failing: true);
    final outbox = ReportOutbox(transport);

    final status = await outbox.submit(report('Ferraillage pile P1'));

    expect(status, SyncStatus.queued);
    expect(outbox.pending, hasLength(1));
  });

  test('drain delivers queued reports in order once back online', () async {
    final transport = FakeTransport(failing: true);
    final outbox = ReportOutbox(transport);
    await outbox.submit(report('Jour 1'));
    await outbox.submit(report('Jour 2'));

    transport.failing = false;
    final delivered = await outbox.drain();

    expect(delivered, 2);
    expect(transport.sent.map((r) => r.travauxRealises), ['Jour 1', 'Jour 2']);
    expect(outbox.pending, isEmpty);
  });

  test('drain stops at the first failure and preserves order', () async {
    final transport = FakeTransport(failing: true);
    final outbox = ReportOutbox(transport);
    await outbox.submit(report('Jour 1'));
    await outbox.submit(report('Jour 2'));

    final delivered = await outbox.drain();

    expect(delivered, 0);
    expect(outbox.pending, hasLength(2));
  });
}
