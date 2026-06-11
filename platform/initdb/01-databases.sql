-- First-boot provisioning: per-service roles & databases.
-- Placeholder passwords below MUST be rotated immediately after first boot
-- (ALTER ROLE <name> PASSWORD '<strong>') and mirrored into .env — see
-- platform/README.md "Hard Rules".

CREATE ROLE keycloak LOGIN PASSWORD 'change-me-keycloak';
CREATE DATABASE keycloak OWNER keycloak;

CREATE ROLE odoo LOGIN CREATEDB PASSWORD 'change-me-odoo';
-- Odoo creates its own databases (CREATEDB required).

CREATE ROLE metabase LOGIN PASSWORD 'change-me-metabase';
CREATE DATABASE metabase OWNER metabase;

CREATE ROLE atlas LOGIN PASSWORD 'change-me-atlas';
CREATE DATABASE atlas OWNER atlas;
-- ATLAS Core manages its schemas (tender, bid, intel, project, billing,
-- vault, supply, people, brain, warehouse, audit) via Drizzle migrations.

\connect atlas
CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- fuzzy matching (entity resolution)
CREATE EXTENSION IF NOT EXISTS unaccent;     -- FR text normalization
