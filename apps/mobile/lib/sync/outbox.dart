/// Offline-first sync engine for the journal de chantier.
///
/// Reports are accepted locally no matter the connectivity; the outbox
/// retries against the ATLAS API when asked (app resume, connectivity
/// regained). Transport is abstract so tests and future HTTP/queue
/// implementations share the exact same engine.
library;

/// Mirrors POST /api/field/projects/:id/logs.
class PendingReport {
  const PendingReport({
    required this.projectId,
    required this.reportDate,
    required this.effectifs,
    required this.travauxRealises,
    this.blocages,
    this.incidentsSecurite = 0,
  });

  final String projectId;
  final DateTime reportDate;
  final int effectifs;
  final String travauxRealises;
  final String? blocages;
  final int incidentsSecurite;
}

/// One delivery attempt. Implementations: HTTP client (next), fakes (tests).
abstract interface class ReportTransport {
  Future<void> send(PendingReport report);
}

/// Outcome of a submit or drain pass.
enum SyncStatus { sent, queued }

class ReportOutbox {
  ReportOutbox(this._transport);

  final ReportTransport _transport;
  List<PendingReport> _pending = const [];

  List<PendingReport> get pending => List.unmodifiable(_pending);

  /// Try to send now; on any transport failure the report is queued —
  /// the chantier never loses a report to a dead zone.
  Future<SyncStatus> submit(PendingReport report) async {
    try {
      await _transport.send(report);
      return SyncStatus.sent;
    } on Exception {
      _pending = [..._pending, report];
      return SyncStatus.queued;
    }
  }

  /// Retry everything in order; stops at the first failure so order is
  /// preserved (decomptes and journals are chronological documents).
  Future<int> drain() async {
    var delivered = 0;
    while (_pending.isNotEmpty) {
      final next = _pending.first;
      try {
        await _transport.send(next);
        _pending = _pending.sublist(1);
        delivered += 1;
      } on Exception {
        break;
      }
    }
    return delivered;
  }
}
