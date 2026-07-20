# Runbook — Agent autonome de chiffrage BDC

## Périmètre et garde-fous

L'agent chiffre les lignes de travaux, fournitures et services. Il recherche d'abord les preuves internes vérifiées, puis les pages publiques marocaines autorisées. Chaque proposition conserve sa méthode, sa confiance, ses sources et ses avertissements.

- La marge sur coût estimé ne descend jamais sous `BDC_PRICING_MIN_MARKUP_PCT` (15 % par défaut).
- Quand une estimation administrative est disponible, la proposition vise le corridor ±20 %. Le plancher de marge reste prioritaire si les deux contraintes sont incompatibles.
- Une ligne déjà saisie manuellement est verrouillée et n'est jamais écrasée.
- Le résultat reste un brouillon jusqu'à l'action explicite « Appliquer au bordereau ».
- Seuls les retours vérifiés alimentent l'apprentissage. Un retour non vérifié a un poids nul.

## Configuration serveur

Les variables vivent dans `/opt/atlas/platform/.env.apps`. Ne jamais journaliser la valeur de la clé Brave.

```dotenv
BRAVE_SEARCH_API_KEY=
BDC_PRICE_SOURCE_DOMAINS=bricoma.ma,marjane.ma,electroplanet.ma,jumia.ma
BDC_PRICE_SEARCH_MAX_QUERIES=20
BDC_PRICE_FETCH_MAX_PAGES=30
BDC_PRICE_FETCH_TIMEOUT_MS=12000
BDC_PRICE_MAX_AGE_DAYS=1095
BDC_PRICE_ANNUAL_INFLATION_PCT=0
BDC_PRICING_CONCURRENCY=1
BDC_PRICING_MIN_MARKUP_PCT=15
BDC_PRICING_LEARNING_ENABLED=true
BDC_PRICING_LEARNING_CRON=30 2 * * *
BDC_PRICING_MIN_SEGMENT_SAMPLES=20
BDC_PRICING_HISTORY_DAYS=1095
```

Une clé Brave vide ou une allowlist vide désactive uniquement la recherche web. Le corpus interne reste utilisable. `BDC_PRICING_LEARNING_ENABLED=false` supprime la planification BullMQ d'apprentissage au prochain démarrage du worker, sans interrompre le chiffrage.

### Gouvernance de l'allowlist

La Direction Marchés est propriétaire fonctionnel de la liste. L'administrateur SI ajoute uniquement des domaines marocains connus, en HTTPS, dont les pages exposent un prix et une unité vérifiables. Chaque ajout est relu trimestriellement et après tout incident. L'adaptateur bloque les hôtes hors liste, les adresses privées, les redirections non autorisées, les réponses trop volumineuses et les délais excessifs.

## Déploiement

Le changement introduit `apps/core/drizzle/0052_bdc_autonomous_pricing.sql`. Vérifier que le journal contient `0052_bdc_autonomous_pricing`, pousser le commit, puis lancer sur le VPS :

```bash
ssh root@185.197.249.181
cd /opt/atlas
platform/scripts/deploy.sh
```

Le script tire `master`, reconstruit `core`, `worker` et `web`, applique les nouvelles migrations avant le redémarrage, attend la santé de Core puis teste l'URL publique.

Vérifications immédiates :

```bash
cd /opt/atlas/platform
docker compose -f docker-compose.apps.yml -f apps-ports.yml ps
docker compose -f docker-compose.apps.yml logs --since=15m core worker web
curl -fsS https://atlas.marocinfra.com/api/health
docker compose -f docker-compose.yml exec -T postgres \
  psql -U postgres -d atlas -c "select to_regclass('bdc.pricing_run'), to_regclass('bdc.pricing_calibration');"
```

Le journal du worker doit contenir `BDC pricing worker active` et la cadence d'apprentissage. Une exécution doit progresser par `analyse`, `historique`, `marché`, `estimation`, `décision`, `validation`, puis `terminé`.

## Exploitation et diagnostic

```bash
cd /opt/atlas/platform
docker compose -f docker-compose.apps.yml logs -f --tail=200 worker
docker compose -f docker-compose.yml exec -T redis redis-cli \
  --scan --pattern 'bull:bdc-pricing:*'
docker compose -f docker-compose.apps.yml restart worker
```

Contrôles SQL utiles :

```sql
select id, avis_id, status, stage, progress_pct, calibration_version,
       created_at, updated_at
from bdc.pricing_run
order by created_at desc limit 20;

select version, active, created_at,
       payload->>'sampleCount' as sample_count
from bdc.pricing_calibration
order by created_at desc limit 20;

select source_type, verified, count(*), max(observed_at)
from bdc.price_observation
group by source_type, verified;
```

Échecs fréquents :

- `recherche_web_indisponible` : vérifier uniquement la présence de la clé et l'allowlist, sans afficher la clé.
- `budget_recherche_marche_atteint` : la ligne a conservé les preuves déjà trouvées; augmenter les budgets seulement après revue de charge.
- confiance faible : saisir ou valider une source; ne pas transformer un prix sans preuve en apprentissage vérifié.
- run bloqué : redémarrer le worker. L'idempotence reprend la même exécution sans écraser une saisie manuelle.

## Apprentissage, backtest et retour arrière

L'apprentissage exige au moins 20 exemples vérifiés par segment. Les coûts réels ont le poids le plus fort, les corrections humaines vérifiées restent provisoires, et la fiabilité décroît avec l'ancienneté ou les erreurs d'une source. Une calibration est immuable après publication.

Backtest chronologique :

```bash
docker compose -f docker-compose.apps.yml exec -T core sh -lc \
  'cd /app/apps/core && pnpm tsx scripts/backtest-bdc-pricing.ts \
   --as-of 2026-07-20T00:00:00Z --output /tmp/bdc-backtest.json'
docker compose -f docker-compose.apps.yml cp \
  core:/tmp/bdc-backtest.json /opt/atlas/artifacts/bdc-pricing/backtest.json
```

Pour revenir à une calibration antérieure, couper d'abord l'apprentissage, identifier la version validée, puis effectuer la bascule atomique :

```sql
begin;
update bdc.pricing_calibration set active = false where active = true;
update bdc.pricing_calibration set active = true where version = '<VERSION_VALIDEE>';
commit;
```

Redémarrer ensuite le worker et refaire un chiffrage de contrôle. Ne jamais modifier le `payload` d'une calibration existante.

## Rétention et retrait

Conserver décisions, sources, retours et calibrations au moins pendant la durée contractuelle définie par la Direction Marchés; aucune purge automatique n'est activée. Toute purge doit être précédée d'un export et validée par écrit.

Pour un retrait fonctionnel immédiat : mettre `BDC_PRICING_LEARNING_ENABLED=false`, vider `BRAVE_SEARCH_API_KEY` et `BDC_PRICE_SOURCE_DOMAINS`, puis redémarrer `worker`. Pour retirer aussi l'interface/API, redéployer le commit applicatif précédent; conserver les tables `bdc.pricing_*` pour l'audit et ne les supprimer qu'après export validé.
