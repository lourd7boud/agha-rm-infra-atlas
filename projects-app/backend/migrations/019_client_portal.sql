-- Migration 019: Client Portal — Shared Access Links
-- بوابة العميل — روابط المشاركة
-- Date: 2026-02-19

-- ═══════════════════════════════════════════════════════════════
-- 1. PROJECT SHARE LINKS — Tokenized access for external parties
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS project_share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),

    -- Token for URL access (unique, random)
    token VARCHAR(64) NOT NULL UNIQUE,

    -- Access configuration
    label VARCHAR(200) NOT NULL DEFAULT 'Lien de partage',
    recipient_name VARCHAR(200),
    recipient_email VARCHAR(200),
    recipient_role VARCHAR(100) DEFAULT 'client',  -- client, maitre_ouvrage, bureau_etudes, controleur

    -- Permissions (what can the recipient see)
    permissions JSONB NOT NULL DEFAULT '{
      "overview": true,
      "financials": true,
      "photos": true,
      "documents": false,
      "bordereaux": false,
      "decompts": true,
      "diary": false,
      "ods": false
    }'::jsonb,

    -- Security
    pin_code VARCHAR(10),              -- Optional PIN for extra security
    expires_at TIMESTAMPTZ,            -- Optional expiration
    max_views INTEGER,                 -- Optional maximum views
    view_count INTEGER NOT NULL DEFAULT 0,

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Tracking
    last_accessed_at TIMESTAMPTZ,
    last_accessed_ip VARCHAR(45),

    -- Standard metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════
-- 2. PORTAL ACCESS LOG — Track who views what
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS portal_access_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_link_id UUID NOT NULL REFERENCES project_share_links(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Access details
    ip_address VARCHAR(45),
    user_agent TEXT,
    section_viewed VARCHAR(50),  -- overview, financials, photos, etc.

    -- Timestamp
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_share_links_project ON project_share_links(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_share_links_token ON project_share_links(token) WHERE deleted_at IS NULL AND is_active = true;
CREATE INDEX IF NOT EXISTS idx_share_links_user ON project_share_links(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_access_link ON portal_access_log(share_link_id);
CREATE INDEX IF NOT EXISTS idx_portal_access_project ON portal_access_log(project_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_share_link_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_share_link_updated_at ON project_share_links;
CREATE TRIGGER trg_share_link_updated_at
  BEFORE UPDATE ON project_share_links
  FOR EACH ROW EXECUTE FUNCTION update_share_link_timestamp();

COMMENT ON TABLE project_share_links IS 'Liens de partage pour le portail client — روابط المشاركة';
COMMENT ON TABLE portal_access_log IS 'Historique d''accès au portail client';
