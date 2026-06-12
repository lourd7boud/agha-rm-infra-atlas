import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:atlas_mobile/sync/http_transport.dart';
import 'package:atlas_mobile/sync/outbox.dart';

PendingReport report() => PendingReport(
      projectId: 'a19b6935-0000-0000-0000-000000000000',
      reportDate: DateTime.utc(2026, 6, 12),
      effectifs: 14,
      travauxRealises: 'Coulage béton semelles culée rive droite',
      blocages: 'Retard livraison acier',
      incidentsSecurite: 1,
    );

void main() {
  test('posts the field-API payload with bearer auth', () async {
    late http.Request captured;
    final client = MockClient((request) async {
      captured = request;
      return http.Response('{}', 201);
    });
    final transport = HttpReportTransport(
      baseUrl: 'https://atlas.example/api',
      tokenProvider: () async => 'jwt-token',
      client: client,
    );

    await transport.send(report());

    expect(
      captured.url.toString(),
      'https://atlas.example/api/field/projects/'
      'a19b6935-0000-0000-0000-000000000000/logs',
    );
    expect(captured.headers['authorization'], 'Bearer jwt-token');
    final body = jsonDecode(captured.body) as Map<String, dynamic>;
    expect(body['reportDate'], '2026-06-12');
    expect(body['effectifs'], 14);
    expect(body['blocages'], 'Retard livraison acier');
    expect(body['incidentsSecurite'], 1);
  });

  test('non-2xx response throws so the outbox queues the report', () async {
    final client = MockClient((_) async => http.Response('conflict', 409));
    final transport = HttpReportTransport(
      baseUrl: 'https://atlas.example/api',
      tokenProvider: () async => 'jwt-token',
      client: client,
    );
    final outbox = ReportOutbox(transport);

    final status = await outbox.submit(report());

    expect(status, SyncStatus.queued);
    expect(outbox.pending, hasLength(1));
  });
}
