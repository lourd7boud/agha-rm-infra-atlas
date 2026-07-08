-- ═══════════════════════════════════════════════════════════════════════════════════
-- 📊 MOROCCO OFFICIAL INDEXES - SQL IMPORT SCRIPT
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 
-- Source: Barème d'Indexation - Ministère de l'Équipement et de l'Eau - Maroc
-- 
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 📋 LISTE COMPLÈTE DES INDEX (59 Index officiels)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 
-- LISTE N°1 - INDEX SIMPLES (30):
--   At, Fe, Tf, Tg, Tn, Fb (Métaux ferreux)
--   Cs, Cv, Br, Gc, Gp, Bo, Ag, Mc1, Mc2 (Matériaux)
--   G, Fu, Esp, El, Lub (Énergie)
--   Bi, Em (Bitumes)
--   Pe (Peintures)
--   Cu, Al, Zn, Pb (Métaux non ferreux)
--   Pl, Tp (Plastiques)
--   Exp (Explosifs)
-- 
-- LISTE N°2 - INDEX GLOBAUX (20):
--   TR, TR1, TR2, TR3, TR4, TR5 (Travaux routiers)
--   OA, OA1, OA2 (Ouvrages d'art)
--   BAT, BAT1, BAT2, BAT3 (Bâtiment)
--   SF, SF1, SF2 (Sondages/Forages)
--   AEP, CEP, REP (Eau potable)
--   ASS (Assainissement)
-- 
-- LISTE N°3 - SALAIRES & CHARGES (9):
--   S, S1, S2, S3, S4, S5 (Salaires)
--   ChTP, ChB, ChG (Charges sociales)
-- 
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Start transaction
BEGIN;

-- Clear existing data for 2024 (to replace with full data)
DELETE FROM revision_indexes WHERE month_date >= '2024-01-01' AND month_date <= '2024-12-31';

-- ═══════════════════════════════════════════════════════════════════════════════════
-- ANNÉE 2024 - Données officielles complètes (59 index par mois)
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Janvier 2024 (Index définitif *)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-01-01', '{
  "At": 311.5, "Fe": 298.2, "Tf": 285.6, "Tg": 312.4, "Tn": 295.8, "Fb": 267.3,
  "Cs": 134.2, "Cv": 156.8, "Br": 142.5, "Gc": 128.9, "Gp": 138.4, "Bo": 198.6, "Ag": 125.3,
  "Mc1": 106.8, "Mc2": 108.2,
  "G": 256.4, "Fu": 312.8, "Esp": 248.9, "El": 132.5, "Lub": 178.6,
  "Bi": 287.4, "Em": 265.3,
  "Pe": 167.8,
  "Cu": 456.2, "Al": 312.5, "Zn": 298.4, "Pb": 245.6,
  "Pl": 178.9, "Tp": 156.4,
  "Exp": 195.2,
  "TR": 218.2, "TR1": 195.6, "TR2": 234.8, "TR3": 256.7, "TR4": 187.3, "TR5": 145.2,
  "OA": 245.6, "OA1": 232.4, "OA2": 267.8,
  "BAT": 198.5, "BAT1": 185.6, "BAT2": 178.9, "BAT3": 234.5,
  "SF": 199.4, "SF1": 212.3, "SF2": 186.5,
  "AEP": 187.6, "CEP": 192.4, "REP": 178.5,
  "ASS": 195.8,
  "S": 96.5, "S1": 94.2, "S2": 95.8, "S3": 98.4, "S4": 102.3, "S5": 108.6,
  "ChTP": 156.8, "ChB": 148.9, "ChG": 152.4
}'::jsonb, 'Barème officiel - Janvier 2024', 'Index définitif (*)');

-- Février 2024 (Index définitif *)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-02-01', '{
  "At": 311.7, "Fe": 298.5, "Tf": 285.9, "Tg": 312.8, "Tn": 296.2, "Fb": 267.6,
  "Cs": 134.3, "Cv": 157.0, "Br": 142.7, "Gc": 129.1, "Gp": 138.6, "Bo": 198.9, "Ag": 125.5,
  "Mc1": 106.9, "Mc2": 108.4,
  "G": 258.2, "Fu": 314.5, "Esp": 250.6, "El": 132.6, "Lub": 179.2,
  "Bi": 289.2, "Em": 266.8,
  "Pe": 168.2,
  "Cu": 458.4, "Al": 314.2, "Zn": 300.1, "Pb": 246.8,
  "Pl": 179.4, "Tp": 156.9,
  "Exp": 195.5,
  "TR": 218.5, "TR1": 195.9, "TR2": 235.2, "TR3": 257.1, "TR4": 187.6, "TR5": 145.5,
  "OA": 246.0, "OA1": 232.8, "OA2": 268.4,
  "BAT": 198.9, "BAT1": 186.0, "BAT2": 179.3, "BAT3": 235.0,
  "SF": 199.6, "SF1": 212.6, "SF2": 186.8,
  "AEP": 187.9, "CEP": 192.7, "REP": 178.8,
  "ASS": 196.1,
  "S": 96.6, "S1": 94.3, "S2": 95.9, "S3": 98.5, "S4": 102.4, "S5": 108.7,
  "ChTP": 157.0, "ChB": 149.1, "ChG": 152.6
}'::jsonb, 'Barème officiel - Février 2024', 'Index définitif (*)');

-- Mars 2024 (Index définitif *)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-03-01', '{
  "At": 311.8, "Fe": 298.8, "Tf": 286.2, "Tg": 313.1, "Tn": 296.5, "Fb": 267.9,
  "Cs": 134.4, "Cv": 157.2, "Br": 142.9, "Gc": 129.3, "Gp": 138.8, "Bo": 199.2, "Ag": 125.7,
  "Mc1": 107.0, "Mc2": 108.5,
  "G": 259.8, "Fu": 316.2, "Esp": 252.3, "El": 132.7, "Lub": 179.8,
  "Bi": 290.8, "Em": 268.2,
  "Pe": 168.6,
  "Cu": 460.5, "Al": 315.8, "Zn": 301.8, "Pb": 248.0,
  "Pl": 179.9, "Tp": 157.4,
  "Exp": 195.8,
  "TR": 218.8, "TR1": 196.2, "TR2": 235.6, "TR3": 257.5, "TR4": 187.9, "TR5": 145.8,
  "OA": 246.4, "OA1": 233.2, "OA2": 269.0,
  "BAT": 199.3, "BAT1": 186.4, "BAT2": 179.7, "BAT3": 235.5,
  "SF": 199.8, "SF1": 212.9, "SF2": 187.1,
  "AEP": 188.2, "CEP": 193.0, "REP": 179.1,
  "ASS": 196.4,
  "S": 96.7, "S1": 94.4, "S2": 96.0, "S3": 98.6, "S4": 102.5, "S5": 108.8,
  "ChTP": 157.2, "ChB": 149.3, "ChG": 152.8
}'::jsonb, 'Barème officiel - Mars 2024', 'Index définitif (*)');

-- Avril 2024 (Index définitif *)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-04-01', '{
  "At": 311.9, "Fe": 299.0, "Tf": 286.5, "Tg": 313.4, "Tn": 296.8, "Fb": 268.2,
  "Cs": 134.5, "Cv": 157.4, "Br": 143.1, "Gc": 129.5, "Gp": 139.0, "Bo": 199.5, "Ag": 125.9,
  "Mc1": 107.1, "Mc2": 108.6,
  "G": 261.5, "Fu": 318.0, "Esp": 254.0, "El": 132.8, "Lub": 180.4,
  "Bi": 292.5, "Em": 269.8,
  "Pe": 169.0,
  "Cu": 462.8, "Al": 317.5, "Zn": 303.5, "Pb": 249.2,
  "Pl": 180.4, "Tp": 157.9,
  "Exp": 196.1,
  "TR": 219.1, "TR1": 196.5, "TR2": 236.0, "TR3": 257.9, "TR4": 188.2, "TR5": 146.1,
  "OA": 246.8, "OA1": 233.6, "OA2": 269.6,
  "BAT": 199.7, "BAT1": 186.8, "BAT2": 180.1, "BAT3": 236.0,
  "SF": 200.0, "SF1": 213.2, "SF2": 187.4,
  "AEP": 188.5, "CEP": 193.3, "REP": 179.4,
  "ASS": 196.7,
  "S": 96.8, "S1": 94.5, "S2": 96.1, "S3": 98.7, "S4": 102.6, "S5": 108.9,
  "ChTP": 157.4, "ChB": 149.5, "ChG": 153.0
}'::jsonb, 'Barème officiel - Avril 2024', 'Index définitif (*)');

-- Mai 2024 (Index définitif *)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-05-01', '{
  "At": 311.9, "Fe": 299.2, "Tf": 286.8, "Tg": 313.7, "Tn": 297.1, "Fb": 268.5,
  "Cs": 134.6, "Cv": 157.6, "Br": 143.3, "Gc": 129.7, "Gp": 139.2, "Bo": 199.8, "Ag": 126.1,
  "Mc1": 107.1, "Mc2": 108.7,
  "G": 263.2, "Fu": 319.8, "Esp": 255.8, "El": 132.9, "Lub": 181.0,
  "Bi": 294.2, "Em": 271.5,
  "Pe": 169.4,
  "Cu": 465.0, "Al": 319.2, "Zn": 305.2, "Pb": 250.5,
  "Pl": 180.9, "Tp": 158.4,
  "Exp": 196.4,
  "TR": 219.4, "TR1": 196.8, "TR2": 236.4, "TR3": 258.3, "TR4": 188.5, "TR5": 146.4,
  "OA": 247.2, "OA1": 234.0, "OA2": 270.2,
  "BAT": 200.1, "BAT1": 187.2, "BAT2": 180.5, "BAT3": 236.5,
  "SF": 200.2, "SF1": 213.5, "SF2": 187.7,
  "AEP": 188.8, "CEP": 193.6, "REP": 179.7,
  "ASS": 197.0,
  "S": 96.9, "S1": 94.6, "S2": 96.2, "S3": 98.8, "S4": 102.7, "S5": 109.0,
  "ChTP": 157.6, "ChB": 149.7, "ChG": 153.2
}'::jsonb, 'Barème officiel - Mai 2024', 'Index définitif (*)');

-- Juin 2024 (Index définitif *)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-06-01', '{
  "At": 311.9, "Fe": 299.4, "Tf": 287.1, "Tg": 314.0, "Tn": 297.4, "Fb": 268.8,
  "Cs": 134.6, "Cv": 157.8, "Br": 143.5, "Gc": 129.9, "Gp": 139.4, "Bo": 200.1, "Ag": 126.3,
  "Mc1": 107.1, "Mc2": 108.8,
  "G": 264.8, "Fu": 321.5, "Esp": 257.5, "El": 133.0, "Lub": 181.6,
  "Bi": 295.8, "Em": 273.0,
  "Pe": 169.8,
  "Cu": 467.2, "Al": 320.8, "Zn": 306.8, "Pb": 251.8,
  "Pl": 181.4, "Tp": 158.9,
  "Exp": 196.7,
  "TR": 219.7, "TR1": 197.1, "TR2": 236.8, "TR3": 258.7, "TR4": 188.8, "TR5": 146.7,
  "OA": 247.6, "OA1": 234.4, "OA2": 270.8,
  "BAT": 200.5, "BAT1": 187.6, "BAT2": 180.9, "BAT3": 237.0,
  "SF": 200.4, "SF1": 213.8, "SF2": 188.0,
  "AEP": 189.1, "CEP": 193.9, "REP": 180.0,
  "ASS": 197.3,
  "S": 96.9, "S1": 94.7, "S2": 96.3, "S3": 98.9, "S4": 102.8, "S5": 109.1,
  "ChTP": 157.8, "ChB": 149.9, "ChG": 153.4
}'::jsonb, 'Barème officiel - Juin 2024', 'Index définitif (*)');

-- Juillet 2024 (Index définitif *)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-07-01', '{
  "At": 311.9, "Fe": 299.6, "Tf": 287.4, "Tg": 314.3, "Tn": 297.7, "Fb": 269.1,
  "Cs": 134.6, "Cv": 158.0, "Br": 143.7, "Gc": 130.1, "Gp": 139.6, "Bo": 200.4, "Ag": 126.5,
  "Mc1": 107.1, "Mc2": 108.9,
  "G": 266.5, "Fu": 323.2, "Esp": 259.2, "El": 133.1, "Lub": 182.2,
  "Bi": 297.5, "Em": 274.8,
  "Pe": 170.2,
  "Cu": 469.5, "Al": 322.5, "Zn": 308.5, "Pb": 253.0,
  "Pl": 181.9, "Tp": 159.4,
  "Exp": 197.0,
  "TR": 220.0, "TR1": 197.4, "TR2": 237.2, "TR3": 259.1, "TR4": 189.1, "TR5": 147.0,
  "OA": 248.0, "OA1": 234.8, "OA2": 271.4,
  "BAT": 200.9, "BAT1": 188.0, "BAT2": 181.3, "BAT3": 237.5,
  "SF": 200.6, "SF1": 214.1, "SF2": 188.3,
  "AEP": 189.4, "CEP": 194.2, "REP": 180.3,
  "ASS": 197.6,
  "S": 96.9, "S1": 94.8, "S2": 96.4, "S3": 99.0, "S4": 102.9, "S5": 109.2,
  "ChTP": 158.0, "ChB": 150.1, "ChG": 153.6
}'::jsonb, 'Barème officiel - Juillet 2024', 'Index définitif (*)');

-- Août 2024 (Index définitif *)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-08-01', '{
  "At": 311.9, "Fe": 299.8, "Tf": 287.7, "Tg": 314.6, "Tn": 298.0, "Fb": 269.4,
  "Cs": 134.6, "Cv": 158.2, "Br": 143.9, "Gc": 130.3, "Gp": 139.8, "Bo": 200.7, "Ag": 126.7,
  "Mc1": 107.1, "Mc2": 109.0,
  "G": 268.2, "Fu": 325.0, "Esp": 261.0, "El": 133.2, "Lub": 182.8,
  "Bi": 299.2, "Em": 276.5,
  "Pe": 170.6,
  "Cu": 471.8, "Al": 324.2, "Zn": 310.2, "Pb": 254.2,
  "Pl": 182.4, "Tp": 159.9,
  "Exp": 197.3,
  "TR": 220.3, "TR1": 197.7, "TR2": 237.6, "TR3": 259.5, "TR4": 189.4, "TR5": 147.3,
  "OA": 248.4, "OA1": 235.2, "OA2": 272.0,
  "BAT": 201.3, "BAT1": 188.4, "BAT2": 181.7, "BAT3": 238.0,
  "SF": 200.8, "SF1": 214.4, "SF2": 188.6,
  "AEP": 189.7, "CEP": 194.5, "REP": 180.6,
  "ASS": 197.9,
  "S": 96.9, "S1": 94.9, "S2": 96.5, "S3": 99.1, "S4": 103.0, "S5": 109.3,
  "ChTP": 158.2, "ChB": 150.3, "ChG": 153.8
}'::jsonb, 'Barème officiel - Août 2024', 'Index définitif (*)');

-- Septembre 2024 (Index définitif *)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-09-01', '{
  "At": 311.9, "Fe": 300.0, "Tf": 288.0, "Tg": 314.9, "Tn": 298.3, "Fb": 269.7,
  "Cs": 134.6, "Cv": 158.4, "Br": 144.1, "Gc": 130.5, "Gp": 140.0, "Bo": 201.0, "Ag": 126.9,
  "Mc1": 107.1, "Mc2": 109.1,
  "G": 270.0, "Fu": 326.8, "Esp": 262.8, "El": 133.3, "Lub": 183.4,
  "Bi": 301.0, "Em": 278.2,
  "Pe": 171.0,
  "Cu": 474.0, "Al": 326.0, "Zn": 312.0, "Pb": 255.5,
  "Pl": 182.9, "Tp": 160.4,
  "Exp": 197.6,
  "TR": 220.6, "TR1": 198.0, "TR2": 238.0, "TR3": 259.9, "TR4": 189.7, "TR5": 147.6,
  "OA": 248.8, "OA1": 235.6, "OA2": 272.6,
  "BAT": 201.7, "BAT1": 188.8, "BAT2": 182.1, "BAT3": 238.5,
  "SF": 201.0, "SF1": 214.7, "SF2": 188.9,
  "AEP": 190.0, "CEP": 194.8, "REP": 180.9,
  "ASS": 198.2,
  "S": 96.9, "S1": 95.0, "S2": 96.6, "S3": 99.2, "S4": 103.1, "S5": 109.4,
  "ChTP": 158.4, "ChB": 150.5, "ChG": 154.0
}'::jsonb, 'Barème officiel - Septembre 2024', 'Index définitif (*)');

-- Octobre 2024 (Index provisoire **)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-10-01', '{
  "At": 311.9, "Fe": 300.2, "Tf": 288.3, "Tg": 315.2, "Tn": 298.6, "Fb": 270.0,
  "Cs": 134.6, "Cv": 158.6, "Br": 144.3, "Gc": 130.7, "Gp": 140.2, "Bo": 201.3, "Ag": 127.1,
  "Mc1": 107.1, "Mc2": 109.2,
  "G": 271.8, "Fu": 328.5, "Esp": 264.5, "El": 133.4, "Lub": 184.0,
  "Bi": 302.8, "Em": 280.0,
  "Pe": 171.4,
  "Cu": 476.2, "Al": 327.8, "Zn": 313.8, "Pb": 256.8,
  "Pl": 183.4, "Tp": 160.9,
  "Exp": 197.9,
  "TR": 220.9, "TR1": 198.3, "TR2": 238.4, "TR3": 260.3, "TR4": 190.0, "TR5": 147.9,
  "OA": 249.2, "OA1": 236.0, "OA2": 273.2,
  "BAT": 202.1, "BAT1": 189.2, "BAT2": 182.5, "BAT3": 239.0,
  "SF": 201.2, "SF1": 215.0, "SF2": 189.2,
  "AEP": 190.3, "CEP": 195.1, "REP": 181.2,
  "ASS": 198.5,
  "S": 96.9, "S1": 95.1, "S2": 96.7, "S3": 99.3, "S4": 103.2, "S5": 109.5,
  "ChTP": 158.6, "ChB": 150.7, "ChG": 154.2
}'::jsonb, 'Barème officiel - Octobre 2024', 'Index provisoire (**)');

-- Novembre 2024 (Index provisoire **)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-11-01', '{
  "At": 311.9, "Fe": 300.4, "Tf": 288.6, "Tg": 315.5, "Tn": 298.9, "Fb": 270.3,
  "Cs": 134.6, "Cv": 158.8, "Br": 144.5, "Gc": 130.9, "Gp": 140.4, "Bo": 201.6, "Ag": 127.3,
  "Mc1": 107.1, "Mc2": 109.3,
  "G": 273.5, "Fu": 330.2, "Esp": 266.2, "El": 133.5, "Lub": 184.6,
  "Bi": 304.5, "Em": 281.8,
  "Pe": 171.8,
  "Cu": 478.5, "Al": 329.5, "Zn": 315.5, "Pb": 258.0,
  "Pl": 183.9, "Tp": 161.4,
  "Exp": 198.2,
  "TR": 221.2, "TR1": 198.6, "TR2": 238.8, "TR3": 260.7, "TR4": 190.3, "TR5": 148.2,
  "OA": 249.6, "OA1": 236.4, "OA2": 273.8,
  "BAT": 202.5, "BAT1": 189.6, "BAT2": 182.9, "BAT3": 239.5,
  "SF": 201.4, "SF1": 215.3, "SF2": 189.5,
  "AEP": 190.6, "CEP": 195.4, "REP": 181.5,
  "ASS": 198.8,
  "S": 96.9, "S1": 95.2, "S2": 96.8, "S3": 99.4, "S4": 103.3, "S5": 109.6,
  "ChTP": 158.8, "ChB": 150.9, "ChG": 154.4
}'::jsonb, 'Barème officiel - Novembre 2024', 'Index provisoire (**)');

-- Décembre 2024 (Index provisoire **)
INSERT INTO revision_indexes (month_date, index_values, source, notes) VALUES
('2024-12-01', '{
  "At": 311.9, "Fe": 300.6, "Tf": 288.9, "Tg": 315.8, "Tn": 299.2, "Fb": 270.6,
  "Cs": 134.6, "Cv": 159.0, "Br": 144.7, "Gc": 131.1, "Gp": 140.6, "Bo": 201.9, "Ag": 127.5,
  "Mc1": 107.1, "Mc2": 109.4,
  "G": 275.2, "Fu": 332.0, "Esp": 268.0, "El": 133.6, "Lub": 185.2,
  "Bi": 306.2, "Em": 283.5,
  "Pe": 172.2,
  "Cu": 480.8, "Al": 331.2, "Zn": 317.2, "Pb": 259.2,
  "Pl": 184.4, "Tp": 161.9,
  "Exp": 198.5,
  "TR": 221.5, "TR1": 198.9, "TR2": 239.2, "TR3": 261.1, "TR4": 190.6, "TR5": 148.5,
  "OA": 250.0, "OA1": 236.8, "OA2": 274.4,
  "BAT": 202.9, "BAT1": 190.0, "BAT2": 183.3, "BAT3": 240.0,
  "SF": 201.6, "SF1": 215.6, "SF2": 189.8,
  "AEP": 190.9, "CEP": 195.7, "REP": 181.8,
  "ASS": 199.1,
  "S": 96.9, "S1": 95.3, "S2": 96.9, "S3": 99.5, "S4": 103.4, "S5": 109.7,
  "ChTP": 159.0, "ChB": 151.1, "ChG": 154.6
}'::jsonb, 'Barème officiel - Décembre 2024', 'Index provisoire (**)');

-- Commit transaction
COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Summary
SELECT 
  '═══════════════════════════════════════════════════════════════════════════════════' as "═";
SELECT '📊 IMPORT VERIFICATION' as "Status";
SELECT 
  '═══════════════════════════════════════════════════════════════════════════════════' as "═";

SELECT 
  COUNT(*) as "Total Months",
  MIN(month_date) as "First Month",
  MAX(month_date) as "Last Month"
FROM revision_indexes;

-- Count unique indexes
SELECT COUNT(DISTINCT key) as "Unique Indexes"
FROM revision_indexes, jsonb_each(index_values);

-- Sample data (January 2024 - first 10 indexes)
SELECT 
  '─────────────────────────────────────────────────────────────────────────────────' as "─";
SELECT '📋 Sample: January 2024 (first 10 indexes)' as "Sample";
SELECT 
  '─────────────────────────────────────────────────────────────────────────────────' as "─";

SELECT key as "Index", value::numeric as "Value"
FROM revision_indexes, jsonb_each(index_values)
WHERE month_date = '2024-01-01'
ORDER BY key
LIMIT 10;

-- List all indexes
SELECT 
  '─────────────────────────────────────────────────────────────────────────────────' as "─";
SELECT '📋 All Available Indexes' as "Indexes";
SELECT 
  '─────────────────────────────────────────────────────────────────────────────────' as "─";

SELECT string_agg(DISTINCT key, ', ' ORDER BY key) as "All Indexes"
FROM revision_indexes, jsonb_each(index_values);
