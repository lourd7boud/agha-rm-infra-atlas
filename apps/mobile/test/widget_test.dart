import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:atlas_mobile/main.dart';

void main() {
  testWidgets('journal screen renders the report form', (tester) async {
    await tester.pumpWidget(const AtlasMobileApp());

    expect(find.text('Effectifs sur site'), findsOneWidget);
    expect(find.text('Travaux réalisés'), findsOneWidget);
    expect(find.text('Consigner le rapport'), findsOneWidget);
  });

  testWidgets('empty form is rejected by validators', (tester) async {
    await tester.pumpWidget(const AtlasMobileApp());

    await tester.tap(find.text('Consigner le rapport'));
    await tester.pump();

    expect(find.text("Nombre d'ouvriers requis"), findsOneWidget);
    expect(
      find.text('Décrire les travaux (10 caractères min)'),
      findsOneWidget,
    );
  });

  testWidgets('valid report is confirmed locally', (tester) async {
    await tester.pumpWidget(const AtlasMobileApp());

    await tester.enterText(find.byType(TextFormField).at(0), '14');
    await tester.enterText(
      find.byType(TextFormField).at(1),
      'Coulage béton semelles culée rive droite',
    );
    await tester.tap(find.text('Consigner le rapport'));
    await tester.pump();

    expect(
      find.text('Rapport consigné localement — synchronisation à venir.'),
      findsOneWidget,
    );
  });
}
