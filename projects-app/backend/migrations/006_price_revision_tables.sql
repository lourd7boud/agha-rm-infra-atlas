-- ═══════════════════════════════════════════════════════════════════════════
-- 📊 Price Revision Tables - Migration Script
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- 📌 Phase 1: Foundation tables for price revision system
-- 📌 Status: DEV ONLY - معزول تماماً
-- 📌 Database: btpdb_staging (NOT production)
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1️⃣ revision_formulas - صيغ المراجعة
-- ═══════════════════════════════════════════════════════════════════════════
-- يخزن الصيغ المختلفة للمراجعة (قد تختلف من صفقة لأخرى)

CREATE TABLE IF NOT EXISTS revision_formulas (
    id SERIAL PRIMARY KEY,
    
    -- معلومات الصيغة
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- الجزء الثابت
    fixed_part DECIMAL(5, 4) NOT NULL DEFAULT 0.15,
    
    -- أوزان المؤشرات (JSONB للمرونة)
    -- مثال: {"At": 0.25, "Cs": 0.25, "Mc1": 0.25, "S": 0.10}
    weights JSONB NOT NULL,
    
    -- هل هي الصيغة الافتراضية؟
    is_default BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for default formula lookup
CREATE INDEX IF NOT EXISTS idx_revision_formulas_default ON revision_formulas(is_default) WHERE is_default = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2️⃣ revision_indexes - مؤشرات الأشهر
-- ═══════════════════════════════════════════════════════════════════════════
-- يخزن قيم المؤشرات لكل شهر (At, Cs, Mc1, S...)
-- تُدخل شهرياً من مصادر رسمية

CREATE TABLE IF NOT EXISTS revision_indexes (
    id SERIAL PRIMARY KEY,
    
    -- الشهر (YYYY-MM format stored as date for first of month)
    month_date DATE NOT NULL,
    
    -- المؤشرات الأساسية
    index_at DECIMAL(10, 2),      -- Indice des salaires
    index_cs DECIMAL(10, 2),      -- Indice du ciment
    index_mc1 DECIMAL(10, 2),     -- Indice des matériaux de construction
    index_s DECIMAL(10, 2),       -- Indice du carburant
    
    -- مؤشرات إضافية (للصيغ المخصصة)
    extra_indexes JSONB DEFAULT '{}',
    
    -- مصدر البيانات
    source VARCHAR(255),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraint: شهر واحد فقط لكل تاريخ
    CONSTRAINT unique_month_indexes UNIQUE (month_date)
);

-- Index for month lookup
CREATE INDEX IF NOT EXISTS idx_revision_indexes_month ON revision_indexes(month_date);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3️⃣ project_revision_config - إعدادات المراجعة للمشروع
-- ═══════════════════════════════════════════════════════════════════════════
-- يخزن إعدادات المراجعة الخاصة بكل مشروع

CREATE TABLE IF NOT EXISTS project_revision_config (
    id SERIAL PRIMARY KEY,
    
    -- ربط بالمشروع (UUID type)
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    
    -- الصيغة المستخدمة
    formula_id INTEGER REFERENCES revision_formulas(id),
    
    -- مؤشرات الأساس (Époque de base)
    base_index_at DECIMAL(10, 2) NOT NULL,
    base_index_cs DECIMAL(10, 2) NOT NULL,
    base_index_mc1 DECIMAL(10, 2) NOT NULL,
    base_index_s DECIMAL(10, 2) NOT NULL,
    
    -- مؤشرات أساس إضافية
    extra_base_indexes JSONB DEFAULT '{}',
    
    -- تاريخ الأساس
    base_date DATE,
    
    -- هل المراجعة مفعّلة؟
    is_enabled BOOLEAN DEFAULT TRUE,
    
    -- ملاحظات
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraint: إعداد واحد لكل مشروع
    CONSTRAINT unique_project_revision UNIQUE (project_id)
);

-- Index for project lookup
CREATE INDEX IF NOT EXISTS idx_project_revision_config_project ON project_revision_config(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4️⃣ decompt_revision - نتائج المراجعة للديكونت
-- ═══════════════════════════════════════════════════════════════════════════
-- يخزن نتائج حساب المراجعة لكل ديكونت

CREATE TABLE IF NOT EXISTS decompt_revision (
    id SERIAL PRIMARY KEY,
    
    -- ربط بالديكونت (UUID type)
    decompt_id UUID NOT NULL REFERENCES decompts(id) ON DELETE CASCADE,
    
    -- المبلغ للمراجعة (HT)
    montant_a_reviser DECIMAL(15, 2) NOT NULL,
    
    -- المعامل المطبق (ROUND 4 decimals)
    coefficient_applique DECIMAL(10, 6) NOT NULL,
    
    -- مبلغ المراجعة (TRUNC 2 decimals)
    montant_revision DECIMAL(15, 2) NOT NULL,
    
    -- تفاصيل الحساب (للتدقيق)
    calculation_details JSONB,
    
    -- حالة الحساب
    status VARCHAR(50) DEFAULT 'calculated',
    
    -- Timestamps
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraint: نتيجة واحدة لكل ديكونت
    CONSTRAINT unique_decompt_revision UNIQUE (decompt_id)
);

-- Index for decompt lookup
CREATE INDEX IF NOT EXISTS idx_decompt_revision_decompt ON decompt_revision(decompt_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 📦 INSERT DEFAULT FORMULA
-- ═══════════════════════════════════════════════════════════════════════════

-- الصيغة المعتادة في صفقات BTP المغربية
INSERT INTO revision_formulas (name, description, fixed_part, weights, is_default)
VALUES (
    'Formule BTP Standard',
    'Formule standard pour les marchés BTP: P = P0 × [0.15 + 0.20(At/At0) + 0.25(Cs/Cs0) + 0.25(Mc1/Mc10) + 0.15(S/S0)]',
    0.15,
    '{"At": 0.20, "Cs": 0.25, "Mc1": 0.25, "S": 0.15}',
    true
) ON CONFLICT DO NOTHING;

-- الصيغة البديلة (من ملف Excel المرفق)
INSERT INTO revision_formulas (name, description, fixed_part, weights, is_default)
VALUES (
    'Formule Variante 1',
    'Variante: P = P0 × [0.15 + 0.25(At/At0) + 0.25(Cs/Cs0) + 0.25(Mc1/Mc10) + 0.10(S/S0)]',
    0.15,
    '{"At": 0.25, "Cs": 0.25, "Mc1": 0.25, "S": 0.10}',
    false
) ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 📊 INSERT SAMPLE INDEX DATA (من Excel المرفق)
-- ═══════════════════════════════════════════════════════════════════════════

-- 2024 Monthly Indexes
INSERT INTO revision_indexes (month_date, index_at, index_cs, index_mc1, index_s, source)
VALUES 
    ('2024-01-01', 306.7, 132.1, 106.0, 97.9, 'Excel Reference'),
    ('2024-02-01', 306.7, 132.1, 106.0, 97.9, 'Excel Reference'),
    ('2024-03-01', 306.7, 132.1, 106.0, 97.9, 'Excel Reference'),
    ('2024-04-01', 306.7, 132.1, 106.0, 97.9, 'Excel Reference'),
    ('2024-05-01', 306.7, 132.1, 106.0, 97.9, 'Excel Reference'),
    ('2024-06-01', 306.7, 132.1, 106.0, 97.9, 'Excel Reference'),
    ('2024-07-01', 306.7, 132.1, 106.0, 99.5, 'Excel Reference'),
    ('2024-08-01', 306.7, 134.6, 106.0, 97.0, 'Excel Reference'),
    ('2024-09-01', 306.7, 134.6, 106.0, 97.0, 'Excel Reference'),
    ('2024-10-01', 311.9, 134.6, 107.1, 96.9, 'Excel Reference'),
    ('2024-11-01', 311.9, 134.6, 107.1, 96.9, 'Excel Reference'),
    ('2024-12-01', 311.9, 134.6, 107.1, 96.9, 'Excel Reference')
ON CONFLICT (month_date) DO UPDATE SET
    index_at = EXCLUDED.index_at,
    index_cs = EXCLUDED.index_cs,
    index_mc1 = EXCLUDED.index_mc1,
    index_s = EXCLUDED.index_s,
    source = EXCLUDED.source,
    updated_at = CURRENT_TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════════════
-- 🔧 HELPER FUNCTION: Get coefficient for a month
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_month_coefficient(
    p_month_date DATE,
    p_base_at DECIMAL,
    p_base_cs DECIMAL,
    p_base_mc1 DECIMAL,
    p_base_s DECIMAL,
    p_fixed DECIMAL DEFAULT 0.15,
    p_weight_at DECIMAL DEFAULT 0.25,
    p_weight_cs DECIMAL DEFAULT 0.25,
    p_weight_mc1 DECIMAL DEFAULT 0.25,
    p_weight_s DECIMAL DEFAULT 0.10
)
RETURNS DECIMAL AS $$
DECLARE
    v_index RECORD;
    v_coefficient DECIMAL;
BEGIN
    -- Get indexes for the month
    SELECT * INTO v_index FROM revision_indexes 
    WHERE month_date = date_trunc('month', p_month_date);
    
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    
    -- Calculate coefficient
    -- C = [fixed + w_at(At/At0) + w_cs(Cs/Cs0) + w_mc1(Mc1/Mc10) + w_s(S/S0)] - 1
    v_coefficient := (
        p_fixed +
        p_weight_at * (v_index.index_at / p_base_at) +
        p_weight_cs * (v_index.index_cs / p_base_cs) +
        p_weight_mc1 * (v_index.index_mc1 / p_base_mc1) +
        p_weight_s * (v_index.index_s / p_base_s)
    ) - 1;
    
    -- Round to 4 decimal places (Excel compliance)
    RETURN ROUND(v_coefficient, 4);
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ VERIFICATION QUERIES (للتحقق من صحة التثبيت)
-- ═══════════════════════════════════════════════════════════════════════════

-- Test: Get coefficient for January 2024 with base indexes from Excel
-- Expected: 0.0213
-- SELECT get_month_coefficient(
--     '2024-01-01'::DATE,
--     299.6,  -- base At
--     134.7,  -- base Cs
--     100.0,  -- base Mc1
--     100.0,  -- base S
--     0.15,   -- fixed
--     0.25,   -- weight At
--     0.25,   -- weight Cs
--     0.25,   -- weight Mc1
--     0.10    -- weight S
-- );
