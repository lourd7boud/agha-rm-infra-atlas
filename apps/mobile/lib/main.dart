import 'package:flutter/material.dart';

/// ATLAS Mobile — terrain-first companion (phase 2, v0).
/// v0 scope: brand shell + the journal-de-chantier entry surface.
/// Offline-first sync against /api/field comes next; the portal stays
/// the office cockpit, this app is the chantier's pocket tool.
void main() {
  runApp(const AtlasMobileApp());
}

const _atlasDark = Color(0xFF0F172A);
const _atlasAmber = Color(0xFFD97706);

class AtlasMobileApp extends StatelessWidget {
  const AtlasMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ATLAS — AGHA RM INFRA',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: _atlasAmber,
          primary: _atlasDark,
        ),
        useMaterial3: true,
      ),
      home: const JournalEntryScreen(),
    );
  }
}

/// The daily report form — mirrors POST /api/field/projects/:id/logs.
class JournalEntryScreen extends StatefulWidget {
  const JournalEntryScreen({super.key});

  @override
  State<JournalEntryScreen> createState() => _JournalEntryScreenState();
}

class _JournalEntryScreenState extends State<JournalEntryScreen> {
  final _formKey = GlobalKey<FormState>();
  final _effectifs = TextEditingController();
  final _travaux = TextEditingController();
  final _blocages = TextEditingController();
  bool _saved = false;

  @override
  void dispose() {
    _effectifs.dispose();
    _travaux.dispose();
    _blocages.dispose();
    super.dispose();
  }

  void _submit() {
    final form = _formKey.currentState;
    if (form != null && form.validate()) {
      // v0: local confirmation only. Next: queue offline, sync to
      // /api/field when connectivity returns (offline-first).
      setState(() => _saved = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: _atlasDark,
        foregroundColor: Colors.white,
        title: const Text.rich(
          TextSpan(
            text: 'ATLAS',
            style: TextStyle(fontWeight: FontWeight.w900),
            children: [
              TextSpan(text: '.', style: TextStyle(color: _atlasAmber)),
              TextSpan(
                text: '  Journal de chantier',
                style: TextStyle(fontWeight: FontWeight.w400, fontSize: 16),
              ),
            ],
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _effectifs,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Effectifs sur site',
                  border: OutlineInputBorder(),
                ),
                validator: (value) {
                  final parsed = int.tryParse(value ?? '');
                  if (parsed == null || parsed < 0) {
                    return "Nombre d'ouvriers requis";
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _travaux,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Travaux réalisés',
                  border: OutlineInputBorder(),
                ),
                validator: (value) => (value ?? '').trim().length < 10
                    ? 'Décrire les travaux (10 caractères min)'
                    : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _blocages,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Blocages (optionnel)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 24),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: _atlasDark,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                onPressed: _submit,
                child: const Text('Consigner le rapport'),
              ),
              if (_saved)
                const Padding(
                  padding: EdgeInsets.only(top: 16),
                  child: Text(
                    'Rapport consigné localement — synchronisation à venir.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.green),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
