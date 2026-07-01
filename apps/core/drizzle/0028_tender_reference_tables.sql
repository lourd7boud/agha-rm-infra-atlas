-- Phase 2 (datao parity): normalized reference dimensions on the tender schema.
--
-- Every row's UUID + label is taken VERBATIM from datao's Cube.js meta dump
-- (scratchpad/pen-v2/A5-cube/rows-*.json). Matching the same IDs makes future
-- reconciliation with datao intel trivial — bidder/tender records referencing a
-- foreign UUID will just resolve.
--
-- Cities (1826) and tender_sectors (many) are intentionally NOT seeded here:
-- their size warrants a separate data-load task from the pen-v2 dumps.
--> statement-breakpoint

CREATE TABLE "tender"."tender_status" (
  "id" uuid PRIMARY KEY,
  "code" text NOT NULL UNIQUE,
  "label" text NOT NULL,
  "sort_id" integer NOT NULL
);--> statement-breakpoint

INSERT INTO "tender"."tender_status" ("id", "code", "label", "sort_id") VALUES
  ('589ecb4c-6241-4338-a0f9-eb23b0f25fce', 'OPEN',      'En cours',  1),
  ('989ecbf5-caa0-4808-8fc5-974549b5d5f1', 'DONE',      'Attribué',  2),
  ('c9acec03-67d0-4965-846c-6a6001a03aad', 'CLOSED',    'Clôturé',   3),
  ('b388ef29-cf81-40cf-995b-bd736d8d120f', 'CANCELED',  'Annulé',    4),
  ('cd5b8b02-1eca-4ced-93ae-1bafa884d7bf', 'RECTIFIED', 'Rectifié',  5);--> statement-breakpoint

CREATE TABLE "tender"."tender_category" (
  "id" uuid PRIMARY KEY,
  "label" text NOT NULL UNIQUE
);--> statement-breakpoint

INSERT INTO "tender"."tender_category" ("id", "label") VALUES
  ('7ca3ff4f-cdc9-4fac-9c30-e718f55ac157', 'Travaux'),
  ('cee256de-3e8f-4190-8190-effe85e38acb', 'Fournitures'),
  ('e4130fd4-1c98-4076-b6ec-0ac08dc0b7e3', 'Services');--> statement-breakpoint

-- cluster: 'PUBLIC' = Marchés publics (État & collectivités), 'EEP' = Établissements & Entreprises Publics
CREATE TABLE "tender"."tender_mode" (
  "id" uuid PRIMARY KEY,
  "code" text NOT NULL UNIQUE,
  "label" text NOT NULL,
  "cluster" text NOT NULL CHECK ("cluster" IN ('PUBLIC', 'EEP'))
);--> statement-breakpoint

INSERT INTO "tender"."tender_mode" ("id", "code", "label", "cluster") VALUES
  ('d84d67e0-8722-4843-a76b-4c7603c89455', 'AOO',   'Appel d''offres',                 'PUBLIC'),
  ('9589b382-eb32-4118-92ca-154f82f7926e', 'MN',    'Marché négocié',                  'PUBLIC'),
  ('af795fed-06ff-46c3-aa8f-8c10b3312618', 'DCP',   'Dialogue compétitif',             'PUBLIC'),
  ('b0b2c80a-c01d-40a4-8a65-e2d81b41204b', 'EEI',   'Enchère électronique inversée',  'PUBLIC'),
  ('e083b8e0-8d30-4d7a-bd3d-02f81f11a37e', 'AMI',   'Appel à manifestation d''intérêt','PUBLIC'),
  ('60c89ebd-707e-432b-ae2f-ddce88c96b9a', 'CONSA', 'Consultation Architecturale',     'EEP'),
  ('f382ac6d-fb81-4b48-8ba0-d5e427fb283f', 'CONC',  'Concours',                        'EEP');--> statement-breakpoint

CREATE TABLE "tender"."sub_mode" (
  "id" uuid PRIMARY KEY,
  "mode_id" uuid NOT NULL REFERENCES "tender"."tender_mode"("id"),
  "code" text NOT NULL,
  "label" text NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX "sub_mode_mode_code_uniq" ON "tender"."sub_mode" ("mode_id", "code");--> statement-breakpoint

-- 20 of the 22 sub_modes seeded verbatim; the remaining 2 (outside our Cube
-- query's limit=20 window) can be back-filled later from a fresh dump.
INSERT INTO "tender"."sub_mode" ("id", "mode_id", "code", "label") VALUES
  ('44c38d4a-2eed-41ed-b65b-0d14fa20ac52', 'd84d67e0-8722-4843-a76b-4c7603c89455', 'AOO',        'Appel d''offres ouvert'),
  ('d17dd73c-0999-4a7d-b3fa-f8d30ed5c23b', 'd84d67e0-8722-4843-a76b-4c7603c89455', 'AOR',        'Appel d''offres restreint'),
  ('d1fe7503-c293-4b13-9d2a-18acf6fd0d8d', 'd84d67e0-8722-4843-a76b-4c7603c89455', 'AOS',        'Appel d''offres ouvert simplifié'),
  ('c39e215c-942d-4883-bbca-dde7d8fb4623', 'd84d67e0-8722-4843-a76b-4c7603c89455', 'AOP-1',      'Appel d''offres avec préselection - Phase 1'),
  ('6b0ac2f1-abbd-4353-a2f1-cc38536aaa1d', '9589b382-eb32-4118-92ca-154f82f7926e', 'MNSP',       'Marché négocié sans publicité préalable'),
  ('9e347999-aed9-4b0c-9fef-114831749180', '9589b382-eb32-4118-92ca-154f82f7926e', 'MNAP-1',     'Marché négocié avec publicité préalable - Phase 1'),
  ('9287ad60-70f1-40c3-94a1-54ba3d03f365', '9589b382-eb32-4118-92ca-154f82f7926e', 'MNAP-2',     'Marché négocié avec publicité préalable - Phase 2'),
  ('3a218151-ae62-48dc-af37-7fbf74ea242a', 'af795fed-06ff-46c3-aa8f-8c10b3312618', 'DCP1',       'Dialogue compétitif - Phase 1'),
  ('4726ea1f-a90d-420d-959d-7de720087f0b', 'af795fed-06ff-46c3-aa8f-8c10b3312618', 'DCP2',       'Dialogue compétitif - Phase 2'),
  ('569526ad-a998-447e-b2f6-afb9c1077566', 'af795fed-06ff-46c3-aa8f-8c10b3312618', 'DCP3',       'Dialogue compétitif - Phase 3'),
  ('4dab460a-c15a-454d-9cdf-c17a528985de', 'b0b2c80a-c01d-40a4-8a65-e2d81b41204b', 'EEI',        'Enchère électronique inversée'),
  ('021b8f75-ec0b-462c-b1c5-fb8870831786', 'e083b8e0-8d30-4d7a-bd3d-02f81f11a37e', 'AMI',        'Appel à manifestation d''intérêt'),
  ('b18df46e-801c-4760-b04c-318c160115e6', '60c89ebd-707e-432b-ae2f-ddce88c96b9a', 'CONSA',      'Consultation architecturale ouverte'),
  ('327367fe-9de3-4e65-a3e1-cafefba3b2ee', '60c89ebd-707e-432b-ae2f-ddce88c96b9a', 'AOAR',       'Consultation architecturale restreinte'),
  ('359d019a-49f4-4f85-9812-397fefaa3db5', '60c89ebd-707e-432b-ae2f-ddce88c96b9a', 'CONSANSP',   'Consultation architecturale négociée sans publicité préalable'),
  ('16478579-b7f0-4de9-83c1-804bb8bb6f59', '60c89ebd-707e-432b-ae2f-ddce88c96b9a', 'CONSANAP-1', 'Consultation architecturale négociée avec publicité préalable - Phase 1'),
  ('1dd4b77d-2037-409a-98ed-873f5369649a', '60c89ebd-707e-432b-ae2f-ddce88c96b9a', 'CONSANAP-2', 'Consultation architecturale négociée avec publicité préalable - Phase 2'),
  ('57f0707c-6504-4a2e-815e-59710abbb91f', 'f382ac6d-fb81-4b48-8ba0-d5e427fb283f', 'CONCA',      'Concours Architectural'),
  ('ec911599-2b5c-4cad-91e5-d925764aaa2b', 'f382ac6d-fb81-4b48-8ba0-d5e427fb283f', 'CONC-1',     'Concours Phase 1'),
  ('e3b057b8-6e01-4f5b-8105-9e927403050c', 'f382ac6d-fb81-4b48-8ba0-d5e427fb283f', 'CONC-2',     'Concours Phase 2');--> statement-breakpoint

CREATE TABLE "tender"."region" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL UNIQUE
);--> statement-breakpoint

INSERT INTO "tender"."region" ("id", "name") VALUES
  ('5676d6a1-5084-4b2c-a4f6-b0f2025f5613', 'Tanger-Tétouan-Al Hoceïma'),
  ('cfbe0c70-c92e-4b26-a585-401662289af0', 'L''Oriental'),
  ('213608ac-bba8-4d0f-9986-82b96aa71a4f', 'Fès-Meknès'),
  ('64ba9934-d8c9-4edf-be6e-bf2e89909a9f', 'Rabat-Salé-Kénitra'),
  ('820cc634-398e-4aad-80b2-029d30062b85', 'Béni Mellal-Khénifra'),
  ('8f6a3c77-51cb-49fb-b238-f7f7e0adc1fb', 'Casablanca-Settat'),
  ('9acb82ad-e6cc-4480-b9ec-ae377470ffc6', 'Marrakech-Safi'),
  ('de91e8f2-b3c0-4848-9c08-434dbab8cbf6', 'Drâa-Tafilalet'),
  ('b520801f-d61f-43ba-b0e2-4729c52e3488', 'Souss-Massa'),
  ('a5785019-5cbd-438b-84de-2c1f795b0453', 'Guelmim-Oued Noun'),
  ('59fc599e-dd7b-4881-81ec-5debe1b87ff4', 'Laâyoune-Sakia El Hamra'),
  ('7832842f-3024-4784-bbc1-a7773cdcb015', 'Dakhla-Oued Ed-Dahab');--> statement-breakpoint

CREATE TABLE "tender"."bidder_status" (
  "id" uuid PRIMARY KEY,
  "code" text NOT NULL UNIQUE,
  "label" text NOT NULL
);--> statement-breakpoint

INSERT INTO "tender"."bidder_status" ("id", "code", "label") VALUES
  ('1a20c274-ff13-426f-b54b-d3e55d9682a6', 'APPLIED',  'Déposé'),
  ('2659c948-090d-4fcd-9e2a-68ed67f2f5b8', 'ACCEPTED', 'Admis'),
  ('4d721a20-4556-4cff-be40-c445cfab73a7', 'REJECTED', 'Ecarté'),
  ('4e3b2685-6373-4c8a-b231-7ed6e2c61962', 'AWARDED',  'Remporté');
