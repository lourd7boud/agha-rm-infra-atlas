import 'dart:convert';

import 'package:http/http.dart' as http;

import 'outbox.dart';

/// HTTP delivery against the ATLAS field API
/// (POST {baseUrl}/field/projects/{projectId}/logs).
///
/// The bearer token is injected: obtaining it (Keycloak mobile flow)
/// is the auth layer's job, not the transport's. Any non-2xx response
/// throws so the outbox keeps the report queued.
class HttpReportTransport implements ReportTransport {
  HttpReportTransport({
    required this.baseUrl,
    required this.tokenProvider,
    http.Client? client,
  }) : _client = client ?? http.Client();

  /// e.g. https://atlas.marocinfra.com/api
  final String baseUrl;
  final Future<String> Function() tokenProvider;
  final http.Client _client;

  @override
  Future<void> send(PendingReport report) async {
    final token = await tokenProvider();
    final uri = Uri.parse('$baseUrl/field/projects/${report.projectId}/logs');
    final response = await _client.post(
      uri,
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'reportDate': report.reportDate.toIso8601String().substring(0, 10),
        'effectifs': report.effectifs,
        'travauxRealises': report.travauxRealises,
        if (report.blocages != null) 'blocages': report.blocages,
        'incidentsSecurite': report.incidentsSecurite,
      }),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw http.ClientException(
        'ATLAS field API ${response.statusCode}',
        uri,
      );
    }
  }
}
