-- ═══════════════════════════════════════════════════════════════════════════
-- 📊 Price Revision Tables v2 - Generic & Data-Driven
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- 📌 Phase 2: Generic schema - لا أسماء مؤشرات ثابتة
-- 📌 Status: DEV ONLY
-- 📌 Database: btpdb_staging
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 🗑️ DROP OLD TABLES (إذا وجدت)
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS decompt_revision CASCADE;
DROP TABLE IF EXISTS project_revision_config CASCADE;
DROP TABLE IF EXISTS revision_indexes CASCADE;
DROP TABLE IF EXISTS revision_formulas CASCADE;
DROP FUNCTION IF EXISTS get_month_coefficient CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1️⃣ revision_formulas - صيغ المراجعة (Generic)
-- ═══════════════════════════════════════════════════════════════════════════
-- يخزن الصيغ بشكل ديناميكي - أي عدد وأسماء مؤشرات

CREATE TABLE revision_formulas (
    id SERIAL PRIMARY KEY,
    
    -- معلومات الصيغة
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- الجزء الثابت
    fixed_part DECIMAL(5, 4) NOT NULL DEFAULT 0.15,
    
    -- أوزان المؤشرات (JSONB ديناميكي)
    -- مثال 1 (4 مؤشرات): {"At": 0.25, "Cs": 0.25, "Mc1": 0.25, "S": 0.10}
    -- مثال 2 (3 مؤشرات): {"Salaires": 0.35, "Materiaux": 0.30, "Energie": 0.15}
    -- مثال 3 (6 مؤشرات): {"INS_A": 0.20, "INS_B": 0.15, "INS_C": 0.15, ...}
    weights JSONB NOT NULL,
    
    -- هل هي الصيغة الافتراضية؟
    is_default BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_revision_formulas_default ON revision_formulas(is_default) WHERE is_default = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2️⃣ revision_indexes - مؤشرات الأشهر (Generic)
-- ═══════════════════════════════════════════════════════════════════════════
-- يخزن قيم المؤشرات بشكل ديناميكي لكل شهر

CREATE TABLE revision_indexes (
    id SERIAL PRIMARY KEY,
    
    -- الشهر
    month_date DATE NOT NULL,
    
    -- قيم المؤشرات (JSONB ديناميكي)
    -- مثال: {"At": 306.7, "Cs": 134.6, "Mc1": 106.0, "S": 97.0}
    -- أو: {"Salaires": 105.0, "Materiaux": 108.0, "Energie": 112.0}
    index_values JSONB NOT NULL DEFAULT '{}',
    
    -- مصدر البيانات
    source VARCHAR(255),
    
    -- ملاحظات
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_month_indexes UNIQUE (month_date)
);

CREATE INDEX idx_revision_indexes_month ON revision_indexes(month_date);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3️⃣ project_revision_config - إعدادات المراجعة للمشروع
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE project_revision_config (
    id SERIAL PRIMARY KEY,
    
    -- ربط بالمشروع
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    
    -- الصيغة المستخدمة
    formula_id INTEGER REFERENCES revision_formulas(id),
    
    -- مؤشرات الأساس (JSONB ديناميكي)
    -- يجب أن تحتوي على نفس المؤشرات المطلوبة من الصيغة
    base_indexes JSONB NOT NULL DEFAULT '{}',
    
    -- تاريخ الأساس (Époque de base)
    base_date DATE,
    
    -- هل المراجعة مفعّلة؟
    is_enabled BOOLEAN DEFAULT TRUE,
    
    -- ملاحظات
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_project_revision UNIQUE (project_id)
);

CREATE INDEX idx_project_revision_config_project ON project_revision_config(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4️⃣ decompt_revision - نتائج المراجعة للديكونت
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE decompt_revision (
    id SERIAL PRIMARY KEY,
    
    -- ربط بالديكونت
    decompt_id UUID NOT NULL REFERENCES decompts(id) ON DELETE CASCADE,
    
    -- المبلغ للمراجعة (HT)
    montant_a_reviser DECIMAL(15, 2) NOT NULL,
    
    -- المعامل المطبق (ROUND 4 decimals)
    coefficient_applique DECIMAL(10, 6) NOT NULL,
    
    -- مبلغ المراجعة (TRUNC 2 decimals)
    montant_revision DECIMAL(15, 2) NOT NULL,
    
    -- تفاصيل الحساب الكاملة (JSONB)
    calculation_details JSONB,
    
    -- الصيغة المستخدمة (نسخة للأرشيف)
    formula_snapshot JSONB,
    
    -- مؤشرات الأساس المستخدمة (نسخة للأرشيف)
    base_indexes_snapshot JSONB,
    
    -- حالة الحساب
    status VARCHAR(50) DEFAULT 'calculated',
    
    -- Timestamps
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_decompt_revision UNIQUE (decompt_id)
);

CREATE INDEX idx_decompt_revision_decompt ON decompt_revision(decompt_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 📦 INSERT SAMPLE FORMULAS
-- ═══════════════════════════════════════════════════════════════════════════

-- صيغة BTP معتادة (4 مؤشرات)
INSERT INTO revision_formulas (name, description, fixed_part, weights, is_default)
VALUES (
    'Formule BTP Standard (4 index)',
    'P = P0 × [0.15 + 0.20(At/At0) + 0.25(Cs/Cs0) + 0.25(Mc1/Mc10) + 0.15(S/S0)]',
    0.15,
    '{"At": 0.20, "Cs": 0.25, "Mc1": 0.25, "S": 0.15}',
    true
);

-- صيغة Variante 1 (4 مؤشرات - أوزان مختلفة)
INSERT INTO revision_formulas (name, description, fixed_part, weights, is_default)
VALUES (
    'Formule Variante 1 (4 index)',
    'P = P0 × [0.15 + 0.25(At/At0) + 0.25(Cs/Cs0) + 0.25(Mc1/Mc10) + 0.10(S/S0)]',
    0.15,
    '{"At": 0.25, "Cs": 0.25, "Mc1": 0.25, "S": 0.10}',
    false
);

-- صيغة مع 3 مؤشرات (أسماء مختلفة)
INSERT INTO revision_formulas (name, description, fixed_part, weights, is_default)
VALUES (
    'Formule Simple (3 index)',
    'صيغة مبسطة بـ 3 مؤشرات: الأجور، المواد، الطاقة',
    0.20,
    '{"Salaires": 0.35, "Materiaux": 0.30, "Energie": 0.15}',
    false
);

-- صيغة موسعة (6 مؤشرات)
INSERT INTO revision_formulas (name, description, fixed_part, weights, is_default)
VALUES (
    'Formule Étendue (6 index)',
    'صيغة موسعة بـ 6 مؤشرات للمشاريع الكبيرة',
    0.10,
    '{"INS_Salaires": 0.20, "INS_Ciment": 0.15, "INS_Acier": 0.15, "INS_Bois": 0.15, "INS_Carburant": 0.10, "INS_Transport": 0.15}',
    false
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 📊 INSERT SAMPLE INDEX DATA (للصيغة الـ 4 مؤشرات)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO revision_indexes (month_date, index_values, source)
VALUES 
    ('2024-01-01', '{"At": 306.7, "Cs": 132.1, "Mc1": 106.0, "S": 97.9}', 'Excel Reference'),
    ('2024-02-01', '{"At": 306.7, "Cs": 132.1, "Mc1": 106.0, "S": 97.9}', 'Excel Reference'),
    ('2024-03-01', '{"At": 306.7, "Cs": 132.1, "Mc1": 106.0, "S": 97.9}', 'Excel Reference'),
    ('2024-04-01', '{"At": 306.7, "Cs": 132.1, "Mc1": 106.0, "S": 97.9}', 'Excel Reference'),
    ('2024-05-01', '{"At": 306.7, "Cs": 132.1, "Mc1": 106.0, "S": 97.9}', 'Excel Reference'),
    ('2024-06-01', '{"At": 306.7, "Cs": 132.1, "Mc1": 106.0, "S": 97.9}', 'Excel Reference'),
    ('2024-07-01', '{"At": 306.7, "Cs": 132.1, "Mc1": 106.0, "S": 99.5}', 'Excel Reference'),
    ('2024-08-01', '{"At": 306.7, "Cs": 134.6, "Mc1": 106.0, "S": 97.0}', 'Excel Reference'),
    ('2024-09-01', '{"At": 306.7, "Cs": 134.6, "Mc1": 106.0, "S": 97.0}', 'Excel Reference'),
    ('2024-10-01', '{"At": 311.9, "Cs": 134.6, "Mc1": 107.1, "S": 96.9}', 'Excel Reference'),
    ('2024-11-01', '{"At": 311.9, "Cs": 134.6, "Mc1": 107.1, "S": 96.9}', 'Excel Reference'),
    ('2024-12-01', '{"At": 311.9, "Cs": 134.6, "Mc1": 107.1, "S": 96.9}', 'Excel Reference')
ON CONFLICT (month_date) DO UPDATE SET
    index_values = EXCLUDED.index_values,
    source = EXCLUDED.source,
    updated_at = CURRENT_TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════════════
-- 🔧 GENERIC FUNCTION: حساب المعامل
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION calculate_month_coefficient(
    p_month_date DATE,
    p_base_indexes JSONB,
    p_formula_id INTEGER
)
RETURNS DECIMAL AS $$
DECLARE
    v_formula RECORD;
    v_indexes JSONB;
    v_coefficient DECIMAL := 0;
    v_index_name TEXT;
    v_weight DECIMAL;
    v_current_value DECIMAL;
    v_base_value DECIMAL;
    v_ratio DECIMAL;
BEGIN
    -- الحصول على الصيغة
    SELECT * INTO v_formula FROM revision_formulas WHERE id = p_formula_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Formula not found: %', p_formula_id;
    END IF;
    
    -- الحصول على مؤشرات الشهر
    SELECT index_values INTO v_indexes FROM revision_indexes 
    WHERE month_date = date_trunc('month', p_month_date);
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    
    -- البدء بالجزء الثابت
    v_coefficient := v_formula.fixed_part;
    
    -- حساب مساهمة كل مؤشر ديناميكياً
    FOR v_index_name, v_weight IN SELECT * FROM jsonb_each_text(v_formula.weights)
    LOOP
        v_current_value := (v_indexes->>v_index_name)::DECIMAL;
        v_base_value := (p_base_indexes->>v_index_name)::DECIMAL;
        
        IF v_current_value IS NOT NULL AND v_base_value IS NOT NULL AND v_base_value != 0 THEN
            v_ratio := v_current_value / v_base_value;
            v_coefficient := v_coefficient + (v_weight::DECIMAL * v_ratio);
        END IF;
    END LOOP;
    
    -- طرح 1 والتقريب
    v_coefficient := v_coefficient - 1;
    RETURN ROUND(v_coefficient, 4);
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════

-- التحقق من الصيغ
-- SELECT id, name, fixed_part, index_names, is_valid FROM revision_formulas;

-- اختبار الدالة (Aug 2024 = 0.0177 مع الصيغة 2)
-- SELECT calculate_month_coefficient(
--     '2024-08-01'::DATE,
--     '{"At": 299.6, "Cs": 134.7, "Mc1": 100.0, "S": 100.0}'::JSONB,
--     2  -- Formule Variante 1
-- );
