-- 0046_compta — module Comptabilité (CGNC marocain).
-- Schéma compta : profil fiscal, exercices, plan comptable, journaux,
-- écritures en partie double, TVA, déclarations fiscales & sociales,
-- immobilisations, banques, documents légaux, obligations annuelles.
-- Seeds : journaux, plan comptable CGNC (curaté BTP), profil, exercice courant.
CREATE SCHEMA IF NOT EXISTS "compta";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."profil" (
  "id" text PRIMARY KEY DEFAULT 'agha-rm-infra',
  "raison_sociale" text NOT NULL DEFAULT 'AGHA RM INFRA',
  "forme_juridique" text NOT NULL DEFAULT 'SARL',
  "capital_social" numeric(14,2),
  "registre_commerce" text,
  "identifiant_fiscal" text,
  "ice" text,
  "taxe_professionnelle" text,
  "cnss_affiliation" text,
  "adresse" text,
  "ville" text,
  "gerant" text,
  "date_creation" date,
  "exercice_cloture_mois" integer NOT NULL DEFAULT 12,
  "regime_tva" text NOT NULL DEFAULT 'mensuel',
  "prorata_tva" numeric(6,3) NOT NULL DEFAULT 100,
  "taux_is" numeric(6,3) NOT NULL DEFAULT 20,
  "taux_cotisation_minimale" numeric(6,3) NOT NULL DEFAULT 0.25,
  "effectif" integer,
  "assujetti_tp" boolean NOT NULL DEFAULT true,
  "exoneration_tp_jusquau" date,
  "notes" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."exercice" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "annee" integer NOT NULL,
  "date_debut" date NOT NULL,
  "date_fin" date NOT NULL,
  "statut" text NOT NULL DEFAULT 'ouvert',
  "resultat_net" numeric(14,2),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compta_exercice_annee_uniq" ON "compta"."exercice" ("annee");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."compte" (
  "code" text PRIMARY KEY,
  "intitule" text NOT NULL,
  "classe" integer NOT NULL,
  "parent_code" text,
  "is_custom" boolean NOT NULL DEFAULT false,
  "actif" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_compte_classe_idx" ON "compta"."compte" ("classe");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_compte_parent_idx" ON "compta"."compte" ("parent_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."journal" (
  "code" text PRIMARY KEY,
  "intitule" text NOT NULL,
  "type" text NOT NULL DEFAULT 'divers',
  "actif" boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."ecriture" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exercice_id" uuid NOT NULL REFERENCES "compta"."exercice"("id"),
  "journal_code" text NOT NULL REFERENCES "compta"."journal"("code"),
  "numero" integer NOT NULL,
  "date_ecriture" date NOT NULL,
  "piece_ref" text,
  "libelle" text NOT NULL,
  "statut" text NOT NULL DEFAULT 'brouillon',
  "source" text NOT NULL DEFAULT 'manuel',
  "source_id" uuid,
  "total_debit" numeric(14,2) NOT NULL DEFAULT 0,
  "total_credit" numeric(14,2) NOT NULL DEFAULT 0,
  "created_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compta_ecriture_journal_numero_uniq"
  ON "compta"."ecriture" ("exercice_id","journal_code","numero");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_ecriture_date_idx" ON "compta"."ecriture" ("date_ecriture");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_ecriture_exercice_idx" ON "compta"."ecriture" ("exercice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compta_ecriture_source_uniq"
  ON "compta"."ecriture" ("source","source_id")
  WHERE source_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."ecriture_ligne" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ecriture_id" uuid NOT NULL REFERENCES "compta"."ecriture"("id") ON DELETE CASCADE,
  "compte_code" text NOT NULL REFERENCES "compta"."compte"("code"),
  "libelle" text,
  "debit" numeric(14,2) NOT NULL DEFAULT 0,
  "credit" numeric(14,2) NOT NULL DEFAULT 0,
  "tiers" text,
  "ordre" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_ligne_ecriture_idx" ON "compta"."ecriture_ligne" ("ecriture_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_ligne_compte_idx" ON "compta"."ecriture_ligne" ("compte_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."tva_declaration" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "periode_key" text NOT NULL,
  "regime" text NOT NULL DEFAULT 'mensuel',
  "date_echeance" date NOT NULL,
  "tva_collectee" numeric(14,2) NOT NULL DEFAULT 0,
  "tva_deductible_charges" numeric(14,2) NOT NULL DEFAULT 0,
  "tva_deductible_immo" numeric(14,2) NOT NULL DEFAULT 0,
  "credit_anterieur" numeric(14,2) NOT NULL DEFAULT 0,
  "tva_due" numeric(14,2) NOT NULL DEFAULT 0,
  "credit_nouveau" numeric(14,2) NOT NULL DEFAULT 0,
  "statut" text NOT NULL DEFAULT 'a_preparer',
  "date_declaration" date,
  "date_paiement" date,
  "reference" text,
  "note" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compta_tva_periode_uniq" ON "compta"."tva_declaration" ("periode_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."declaration_fiscale" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" text NOT NULL,
  "annee" integer NOT NULL,
  "periode_key" text NOT NULL DEFAULT '',
  "label" text NOT NULL,
  "base" numeric(14,2),
  "montant" numeric(14,2) NOT NULL DEFAULT 0,
  "date_echeance" date NOT NULL,
  "statut" text NOT NULL DEFAULT 'a_venir',
  "date_declaration" date,
  "date_paiement" date,
  "reference" text,
  "note" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compta_declaration_type_periode_uniq"
  ON "compta"."declaration_fiscale" ("type","annee","periode_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_declaration_echeance_idx" ON "compta"."declaration_fiscale" ("date_echeance");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."social_declaration" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "periode_key" text NOT NULL,
  "masse_salariale" numeric(14,2) NOT NULL DEFAULT 0,
  "masse_plafonnee" numeric(14,2) NOT NULL DEFAULT 0,
  "effectif" integer NOT NULL DEFAULT 0,
  "part_salariale" numeric(14,2) NOT NULL DEFAULT 0,
  "part_patronale" numeric(14,2) NOT NULL DEFAULT 0,
  "total_cotisations" numeric(14,2) NOT NULL DEFAULT 0,
  "detail" jsonb NOT NULL DEFAULT '{}',
  "date_echeance" date NOT NULL,
  "statut" text NOT NULL DEFAULT 'a_preparer',
  "date_declaration" date,
  "date_paiement" date,
  "reference" text,
  "note" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compta_social_periode_uniq" ON "compta"."social_declaration" ("periode_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."immobilisation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "designation" text NOT NULL,
  "compte_code" text NOT NULL,
  "categorie" text NOT NULL DEFAULT 'materiel_technique',
  "date_acquisition" date NOT NULL,
  "date_mise_en_service" date,
  "valeur_ht" numeric(14,2) NOT NULL,
  "taux_amortissement" numeric(6,3) NOT NULL DEFAULT 10,
  "statut" text NOT NULL DEFAULT 'actif',
  "date_sortie" date,
  "prix_cession" numeric(14,2),
  "fournisseur" text,
  "piece_ref" text,
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_immo_statut_idx" ON "compta"."immobilisation" ("statut");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."banque_compte" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "banque" text NOT NULL,
  "agence" text,
  "rib" text,
  "devise" text NOT NULL DEFAULT 'MAD',
  "solde_initial" numeric(14,2) NOT NULL DEFAULT 0,
  "date_solde_initial" date,
  "statut" text NOT NULL DEFAULT 'actif',
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."banque_mouvement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "compte_id" uuid NOT NULL REFERENCES "compta"."banque_compte"("id"),
  "date_mouvement" date NOT NULL,
  "libelle" text NOT NULL,
  "montant" numeric(14,2) NOT NULL,
  "reference" text,
  "rapproche" boolean NOT NULL DEFAULT false,
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_mouvement_compte_idx" ON "compta"."banque_mouvement" ("compte_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_mouvement_date_idx" ON "compta"."banque_mouvement" ("date_mouvement");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."legal_document" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" text NOT NULL,
  "titre" text NOT NULL,
  "annee" integer,
  "date_emission" date,
  "date_expiration" date,
  "storage_key" text,
  "file_name" text,
  "mime_type" text,
  "file_size" integer,
  "note" text,
  "created_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_legal_type_idx" ON "compta"."legal_document" ("type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_legal_expiration_idx" ON "compta"."legal_document" ("date_expiration");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compta"."obligation_legale" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "annee" integer NOT NULL,
  "type" text NOT NULL,
  "label" text NOT NULL,
  "date_echeance" date NOT NULL,
  "statut" text NOT NULL DEFAULT 'a_faire',
  "date_fait" date,
  "note" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compta_obligation_annee_type_uniq"
  ON "compta"."obligation_legale" ("annee","type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compta_obligation_echeance_idx" ON "compta"."obligation_legale" ("date_echeance");
--> statement-breakpoint
-- ── Seeds ────────────────────────────────────────────────────────────────────
INSERT INTO "compta"."profil" ("id") VALUES ('agha-rm-infra') ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "compta"."exercice" ("annee","date_debut","date_fin","statut") VALUES
  (2025,'2025-01-01','2025-12-31','ouvert'),
  (2026,'2026-01-01','2026-12-31','ouvert')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "compta"."journal" ("code","intitule","type") VALUES
  ('ACH','Journal des achats','achats'),
  ('VTE','Journal des ventes','ventes'),
  ('BQ','Journal de banque','tresorerie'),
  ('CAI','Journal de caisse','tresorerie'),
  ('PAIE','Journal de paie','paie'),
  ('OD','Opérations diverses','divers')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
-- Plan comptable CGNC — rubriques (2 chiffres) + comptes usuels d'une SARL BTP.
-- La saisie n'est autorisée que sur les codes de 4 chiffres et plus (règle du
-- domaine) ; les rubriques structurent l'arbre.
INSERT INTO "compta"."compte" ("code","intitule","classe","parent_code") VALUES
  ('11','Capitaux propres',1,NULL),
  ('1111','Capital social',1,'11'),
  ('1140','Réserve légale',1,'11'),
  ('1148','Autres réserves',1,'11'),
  ('1161','Report à nouveau (solde créditeur)',1,'11'),
  ('1169','Report à nouveau (solde débiteur)',1,'11'),
  ('1181','Résultats nets en instance d''affectation (SC)',1,'11'),
  ('1191','Résultat net de l''exercice (SC)',1,'11'),
  ('1199','Résultat net de l''exercice (SD)',1,'11'),
  ('13','Capitaux propres assimilés',1,NULL),
  ('1311','Subventions d''investissement reçues',1,'13'),
  ('1351','Provisions pour amortissements dérogatoires',1,'13'),
  ('14','Dettes de financement',1,NULL),
  ('1481','Emprunts auprès des établissements de crédit',1,'14'),
  ('1486','Fournisseurs d''immobilisations',1,'14'),
  ('1488','Dettes de financement diverses',1,'14'),
  ('15','Provisions durables pour risques et charges',1,NULL),
  ('1511','Provisions pour litiges',1,'15'),
  ('1555','Provisions pour charges à répartir',1,'15'),
  ('21','Immobilisations en non-valeurs',2,NULL),
  ('2111','Frais de constitution',2,'21'),
  ('2117','Frais de publicité',2,'21'),
  ('2121','Frais d''acquisition des immobilisations',2,'21'),
  ('22','Immobilisations incorporelles',2,NULL),
  ('2220','Brevets, marques, droits et valeurs similaires',2,'22'),
  ('2230','Fonds commercial',2,'22'),
  ('2285','Logiciels et applications informatiques',2,'22'),
  ('23','Immobilisations corporelles',2,NULL),
  ('2310','Terrains',2,'23'),
  ('2321','Bâtiments',2,'23'),
  ('2327','Agencements et aménagements des constructions',2,'23'),
  ('2331','Installations techniques',2,'23'),
  ('2332','Matériel et outillage',2,'23'),
  ('2340','Matériel de transport',2,'23'),
  ('2351','Mobilier de bureau',2,'23'),
  ('2352','Matériel de bureau',2,'23'),
  ('2355','Matériel informatique',2,'23'),
  ('2356','Agencements, installations et aménagements divers',2,'23'),
  ('2380','Autres immobilisations corporelles',2,'23'),
  ('2392','Immobilisations corporelles en cours',2,'23'),
  ('24','Immobilisations financières',2,NULL),
  ('2411','Prêts au personnel',2,'24'),
  ('2486','Dépôts et cautionnements versés',2,'24'),
  ('2510','Titres de participation',2,'24'),
  ('28','Amortissements des immobilisations',2,NULL),
  ('2811','Amortissements des frais préliminaires',2,'28'),
  ('2822','Amortissements des brevets, marques et droits',2,'28'),
  ('2828','Amortissements des logiciels',2,'28'),
  ('2832','Amortissements des constructions',2,'28'),
  ('2833','Amortissements des installations techniques, matériel et outillage',2,'28'),
  ('2834','Amortissements du matériel de transport',2,'28'),
  ('2835','Amortissements du mobilier, matériel de bureau et aménagements',2,'28'),
  ('2838','Amortissements des autres immobilisations corporelles',2,'28'),
  ('29','Provisions pour dépréciation des immobilisations',2,NULL),
  ('2920','Provisions pour dépréciation des immobilisations incorporelles',2,'29'),
  ('2930','Provisions pour dépréciation des immobilisations corporelles',2,'29'),
  ('31','Stocks',3,NULL),
  ('3111','Marchandises',3,'31'),
  ('3121','Matières premières',3,'31'),
  ('3122','Matières et fournitures consommables',3,'31'),
  ('3131','Produits en cours',3,'31'),
  ('3134','Travaux en cours',3,'31'),
  ('3151','Produits finis',3,'31'),
  ('34','Créances de l''actif circulant',3,NULL),
  ('3411','Fournisseurs — avances et acomptes versés',3,'34'),
  ('3421','Clients',3,'34'),
  ('3423','Clients — retenues de garantie',3,'34'),
  ('3424','Clients douteux ou litigieux',3,'34'),
  ('3425','Clients — effets à recevoir',3,'34'),
  ('3427','Clients — factures à établir et créances sur travaux',3,'34'),
  ('3431','Avances et acomptes au personnel',3,'34'),
  ('3453','Acomptes sur impôts sur les résultats',3,'34'),
  ('3455','État — TVA récupérable',3,'34'),
  ('34551','État — TVA récupérable sur immobilisations',3,'3455'),
  ('34552','État — TVA récupérable sur charges',3,'3455'),
  ('3456','État — crédit de TVA (suivant déclarations)',3,'34'),
  ('3458','État — autres comptes débiteurs',3,'34'),
  ('3481','Créances sur cessions d''immobilisations',3,'34'),
  ('3488','Divers débiteurs',3,'34'),
  ('35','Titres et valeurs de placement',3,NULL),
  ('3501','Actions (valeurs de placement)',3,'35'),
  ('39','Provisions pour dépréciation de l''actif circulant',3,NULL),
  ('3942','Provisions pour dépréciation des clients et comptes rattachés',3,'39'),
  ('44','Dettes du passif circulant',4,NULL),
  ('4411','Fournisseurs',4,'44'),
  ('4415','Fournisseurs — effets à payer',4,'44'),
  ('4417','Fournisseurs — factures non parvenues',4,'44'),
  ('4421','Clients — avances et acomptes reçus',4,'44'),
  ('4432','Rémunérations dues au personnel',4,'44'),
  ('4441','Caisse Nationale de Sécurité Sociale (CNSS)',4,'44'),
  ('4443','Caisses de retraite (CIMR)',4,'44'),
  ('4445','Mutuelles / AMO',4,'44'),
  ('4448','Autres organismes sociaux',4,'44'),
  ('4452','État — impôts, taxes et assimilés (TP, TSC…)',4,'44'),
  ('44525','État — IR retenu à la source (salaires)',4,'4452'),
  ('4453','État — impôts sur les résultats (IS)',4,'44'),
  ('4455','État — TVA facturée',4,'44'),
  ('4456','État — TVA due (suivant déclarations)',4,'44'),
  ('4458','État — autres comptes créditeurs',4,'44'),
  ('4463','Comptes courants des associés (créditeurs)',4,'44'),
  ('4465','Associés — dividendes à payer',4,'44'),
  ('4481','Dettes sur acquisitions d''immobilisations',4,'44'),
  ('4488','Divers créanciers',4,'44'),
  ('45','Autres provisions pour risques et charges',4,NULL),
  ('4501','Provisions pour risques et charges (court terme)',4,'45'),
  ('51','Trésorerie — Actif',5,NULL),
  ('5111','Chèques à encaisser ou à l''encaissement',5,'51'),
  ('5141','Banques (soldes débiteurs)',5,'51'),
  ('5161','Caisses',5,'51'),
  ('55','Trésorerie — Passif',5,NULL),
  ('5520','Crédits d''escompte',5,'55'),
  ('5530','Crédits de trésorerie',5,'55'),
  ('5541','Banques (soldes créditeurs)',5,'55'),
  ('61','Charges d''exploitation',6,NULL),
  ('6111','Achats de marchandises',6,'61'),
  ('6121','Achats de matières premières',6,'61'),
  ('6122','Achats de matières et fournitures consommables',6,'61'),
  ('6123','Achats d''emballages',6,'61'),
  ('6125','Achats non stockés de matières et fournitures',6,'61'),
  ('61251','Achats de fournitures non stockables (eau, électricité)',6,'6125'),
  ('61252','Achats de fournitures d''entretien',6,'6125'),
  ('61253','Achats de petit outillage et petit équipement',6,'6125'),
  ('61255','Carburants et combustibles',6,'6125'),
  ('6126','Achats de travaux, études et prestations de services (sous-traitance)',6,'61'),
  ('6131','Locations et charges locatives',6,'61'),
  ('6132','Redevances de crédit-bail',6,'61'),
  ('6133','Entretien et réparations',6,'61'),
  ('6134','Primes d''assurances',6,'61'),
  ('6135','Rémunérations du personnel extérieur à l''entreprise',6,'61'),
  ('6136','Rémunérations d''intermédiaires et honoraires',6,'61'),
  ('6141','Études, recherches et documentation',6,'61'),
  ('6142','Transports',6,'61'),
  ('6143','Déplacements, missions et réceptions',6,'61'),
  ('6144','Publicité, publications et relations publiques',6,'61'),
  ('6145','Frais postaux et frais de télécommunications',6,'61'),
  ('6146','Cotisations et dons',6,'61'),
  ('6147','Services bancaires',6,'61'),
  ('6161','Impôts et taxes directs (taxe professionnelle, TSC)',6,'61'),
  ('6167','Impôts, taxes et droits assimilés (enregistrement, timbre)',6,'61'),
  ('6171','Rémunérations du personnel',6,'61'),
  ('61741','Cotisations de sécurité sociale (CNSS)',6,'61'),
  ('61742','Cotisations aux caisses de retraite',6,'61'),
  ('61743','Cotisations aux mutuelles / AMO',6,'61'),
  ('61744','Assurances accidents de travail',6,'61'),
  ('6176','Charges sociales diverses',6,'61'),
  ('6182','Pertes sur créances irrécouvrables',6,'61'),
  ('6191','D.E.A. des immobilisations en non-valeurs',6,'61'),
  ('6192','D.E.A. des immobilisations incorporelles',6,'61'),
  ('6193','D.E.A. des immobilisations corporelles',6,'61'),
  ('6195','D.E.P. pour risques et charges',6,'61'),
  ('6196','D.E.P. de l''actif circulant',6,'61'),
  ('63','Charges financières',6,NULL),
  ('6311','Intérêts des emprunts et dettes',6,'63'),
  ('6331','Pertes de change',6,'63'),
  ('6386','Escomptes accordés',6,'63'),
  ('65','Charges non courantes',6,NULL),
  ('6511','VNA des immobilisations corporelles cédées',6,'65'),
  ('6581','Pénalités sur marchés et dédits',6,'65'),
  ('6582','Rappels d''impôts (autres qu''impôts sur les résultats)',6,'65'),
  ('6583','Pénalités et amendes fiscales ou pénales',6,'65'),
  ('67','Impôts sur les résultats',6,NULL),
  ('6701','Impôts sur les bénéfices (IS)',6,'67'),
  ('6705','Imposition minimale annuelle (cotisation minimale)',6,'67'),
  ('71','Produits d''exploitation',7,NULL),
  ('7111','Ventes de marchandises',7,'71'),
  ('7121','Ventes de biens produits',7,'71'),
  ('7124','Travaux et prestations de services',7,'71'),
  ('71241','Travaux facturés — marchés publics (décomptes)',7,'7124'),
  ('71242','Travaux facturés — clients privés',7,'7124'),
  ('7131','Variation des stocks de produits en cours',7,'71'),
  ('7134','Variation des stocks de travaux en cours',7,'71'),
  ('7161','Subventions d''exploitation reçues',7,'71'),
  ('7181','Autres produits d''exploitation',7,'71'),
  ('7197','Transferts de charges d''exploitation',7,'71'),
  ('73','Produits financiers',7,NULL),
  ('7331','Gains de change',7,'73'),
  ('7381','Intérêts et produits assimilés',7,'73'),
  ('7386','Escomptes obtenus',7,'73'),
  ('75','Produits non courants',7,NULL),
  ('7512','Produits des cessions des immobilisations corporelles',7,'75'),
  ('7581','Pénalités et dédits reçus',7,'75'),
  ('7585','Rentrées sur créances soldées',7,'75')
ON CONFLICT ("code") DO NOTHING;
