/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * 📊 INDEX MANAGEMENT CONTROLLER - Phase 4B
 * ═══════════════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints for managing revision indexes:
 * - GET    /indexes              → List all months
 * - GET    /indexes/:month       → Get month details
 * - POST   /indexes              → Add new month
 * - PUT    /indexes/:month       → Update month
 * - DELETE /indexes/:month       → Delete month
 * - POST   /indexes/import       → Excel import
 * - GET    /indexes/template     → Download Excel template
 * - GET    /indexes/audit        → Audit log
 * - GET    /indexes/catalog      → Get index catalog (all known indexes)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════
 */

import { Request, Response } from 'express';
import pool from '../config/postgres';
import logger from '../utils/logger';
import * as XLSX from 'xlsx';

// ═══════════════════════════════════════════════════════════════════════════════════
// INDEX CATALOG - Catalogue Officiel des Index Marocains (Ministère de l'Équipement)
// ═══════════════════════════════════════════════════════════════════════════════════
// Organisation: 4 Listes principales
// - Liste n°1: INDEX SIMPLES (a-o)
// - Liste n°2: INDEX GLOBAUX (Habitat économique + Bâtiments industriels)
// - Liste n°3: SALAIRES ET CHARGES SOCIALES
// - Liste n°4: INDEX GLOBAUX BATIMENT ET TRAVAUX PUBLICS (A-F)
// ═══════════════════════════════════════════════════════════════════════════════════

const INDEX_CATALOG: Record<string, { name: string; category: string; liste: string; subcategory?: string }> = {
  // ═══════════════════════════════════════════════════════════════════════════════
  // LISTE N°1 - INDEX SIMPLES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // a) Métaux ferreux
  A: { name: "Acier rond lisse (pour béton armé)", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  At: { name: "Acier torsadé (pour béton armé)", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Fe: { name: "Fer pour charpente", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Alp: { name: "Poutrelle IPN pour charpente", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Tt: { name: "Tôle moyenne (Thomas ou Martin)", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Af: { name: "Tôle fine laminée à froid", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Ac: { name: "Tôle fine laminée à chaud", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Aa: { name: "Tôle forte en acier A.33", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Ai: { name: "Tôle en acier inoxydable", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Fac: { name: "Feuillard d'acier à câbles", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Aco: { name: "Tôle à cristaux orientés", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Tr: { name: "Tube serrurier", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Ta: { name: "Tube acier", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Tf: { name: "Tuyau de fonte", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Pg: { name: "Pièces spéciales en fonte avec Joint Gibault", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Bd: { name: "Boulons décolletés", category: "1a) Métaux ferreux", liste: "Liste n°1" },
  Bm: { name: "Boulons matricés", category: "1a) Métaux ferreux", liste: "Liste n°1" },

  // b) Métaux non ferreux
  Cf: { name: "Fil de cuivre nu", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  Cu: { name: "Fil de cuivre rigide isolé", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  Bz: { name: "Bronze en lingots 88/12", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  Lt: { name: "Laiton en lingots 65/35", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  Sn: { name: "Etain Banka à 99,9 %", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  Pbl: { name: "Plomb laminé en feuille", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  ZnL: { name: "Zinc laminé", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  Al: { name: "Aluminium A5", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  Ale: { name: "Aluminium-qualité électrique", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  Toa: { name: "Tôle ondulée en aluminium", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  Tia: { name: "Tube d'irrigation en aluminium", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  Alw: { name: "Fil machine Alumoweld", category: "1b) Métaux non ferreux", liste: "Liste n°1" },
  Pra: { name: "Profilés pour menuiserie aluminium", category: "1b) Métaux non ferreux", liste: "Liste n°1" },

  // c) Liants et produits en terre cuite
  Cy: { name: "Ciment en vrac", category: "1c) Liants et terre cuite", liste: "Liste n°1" },
  Cs: { name: "Ciment en sacs", category: "1c) Liants et terre cuite", liste: "Liste n°1" },
  Pl: { name: "Plâtre", category: "1c) Liants et terre cuite", liste: "Liste n°1" },
  Bc: { name: "Brique creuse", category: "1c) Liants et terre cuite", liste: "Liste n°1" },
  Gr: { name: "Grès Cérame", category: "1c) Liants et terre cuite", liste: "Liste n°1" },

  // d) Bois
  Sb: { name: "Sapin blanc", category: "1d) Bois", liste: "Liste n°1" },
  Sr: { name: "Sapin rouge", category: "1d) Bois", liste: "Liste n°1" },
  He: { name: "Hêtre étuvé", category: "1d) Bois", liste: "Liste n°1" },
  Cp: { name: "Contre plaqué d'Okoumé", category: "1d) Bois", liste: "Liste n°1" },

  // e) Huiles et graisses
  Hm: { name: "Huile minérale non détergente", category: "1e) Huiles et graisses", liste: "Liste n°1" },
  Hd: { name: "Huile détergente", category: "1e) Huiles et graisses", liste: "Liste n°1" },
  Hu: { name: "Huile isolante pour transformateurs", category: "1e) Huiles et graisses", liste: "Liste n°1" },
  Hb: { name: "Huiles pour boîtes et ponts", category: "1e) Huiles et graisses", liste: "Liste n°1" },
  Hr: { name: "Huile de rinçage", category: "1e) Huiles et graisses", liste: "Liste n°1" },
  Hf: { name: "Huile de frein", category: "1e) Huiles et graisses", liste: "Liste n°1" },
  Hi: { name: "Huile pour mouvements et systèmes hydrauliques", category: "1e) Huiles et graisses", liste: "Liste n°1" },
  Gm: { name: "Graisse multipurpose à base de lithium", category: "1e) Huiles et graisses", liste: "Liste n°1" },

  // f) Carburant - Combustible - Énergie
  Fu: { name: "Fioul", category: "1f) Carburant et Énergie", liste: "Liste n°1" },
  G: { name: "Gasoil", category: "1f) Carburant et Énergie", liste: "Liste n°1" },
  Esp: { name: "Essence super", category: "1f) Carburant et Énergie", liste: "Liste n°1" },
  Ci: { name: "Charbon Industriel", category: "1f) Carburant et Énergie", liste: "Liste n°1" },
  Ck: { name: "Coke métallurgique", category: "1f) Carburant et Énergie", liste: "Liste n°1" },
  Eh: { name: "Énergie électrique haute tension", category: "1f) Carburant et Énergie", liste: "Liste n°1" },
  Eb: { name: "Énergie électrique basse tension", category: "1f) Carburant et Énergie", liste: "Liste n°1" },
  Emt: { name: "Énergie électrique moyenne tension", category: "1f) Carburant et Énergie", liste: "Liste n°1" },

  // g) Appareils sanitaires
  Wca: { name: "WC à l'anglaise", category: "1g) Appareils sanitaires", liste: "Liste n°1" },
  Wct: { name: "WC à la turque (brut)", category: "1g) Appareils sanitaires", liste: "Liste n°1" },
  Ev: { name: "Évier", category: "1g) Appareils sanitaires", liste: "Liste n°1" },
  La: { name: "Lavabo", category: "1g) Appareils sanitaires", liste: "Liste n°1" },
  Lm: { name: "Lave-mains", category: "1g) Appareils sanitaires", liste: "Liste n°1" },

  // h) Étanchéité - Bitumes - Émulsifiant
  Bi: { name: "Bitume d'étanchéité en sacs", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },
  Biv: { name: "Bitume d'étanchéité en vrac", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },
  Fi: { name: "Feutre imprégné surfacé 27 S ou 1350", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },
  Bs: { name: "Bitume pur routier (*)", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },
  Bs1: { name: "Bitume pur routier grade 20/30 (*)", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },
  Bs2: { name: "Bitume pur routier grade 35/50 (*)", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },
  Bs3: { name: "Bitume pur routier grade 70/100", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },
  Cb: { name: "Bitume fluide routier (*)", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },
  Em: { name: "Émulsifiant", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },
  Ems: { name: "Émulsion (*)", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },
  Ems1: { name: "Émulsion 69%", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },
  Ems2: { name: "Émulsion 55% (*)", category: "1h) Étanchéité et Bitumes", liste: "Liste n°1" },

  // i) Peinture - Vitrerie
  H: { name: "Huile de lin", category: "1i) Peinture et Vitrerie", liste: "Liste n°1" },
  Zn: { name: "Blanc de zinc", category: "1i) Peinture et Vitrerie", liste: "Liste n°1" },
  Mm: { name: "Minium de plomb", category: "1i) Peinture et Vitrerie", liste: "Liste n°1" },
  Pp: { name: "Produits de peinture", category: "1i) Peinture et Vitrerie", liste: "Liste n°1" },
  Ve: { name: "Verre simple étiré", category: "1i) Peinture et Vitrerie", liste: "Liste n°1" },
  Vep: { name: "Verre à vitre épais", category: "1i) Peinture et Vitrerie", liste: "Liste n°1" },
  Vl: { name: "Verre laminé", category: "1i) Peinture et Vitrerie", liste: "Liste n°1" },
  Gl: { name: "Glace polie", category: "1i) Peinture et Vitrerie", liste: "Liste n°1" },

  // j) Caoutchouc et isolants divers
  Pe: { name: "Polyéthylène", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Pei: { name: "Polyéthylène réticulé", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Peir: { name: "Polyéthylène pour tuyau d'irrigation", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Cv: { name: "Chlorure polyvinyle (isolant)", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Cg: { name: "Chlorure polyvinyle (gaine)", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Ne: { name: "Caoutchouc artificiel (Néoprène)", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Bu: { name: "Caoutchouc artificiel \"Butyl\"", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Dc: { name: "Diélectrique chloré ou \"pyralène\"", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Ip: { name: "Isolant en papier imprégné", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Smr: { name: "Caoutchouc naturel SMR.20", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Sbr: { name: "Caoutchouc synthétique SBR 1500", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Ept: { name: "Caoutchouc synthétique EPT", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Nca: { name: "Noir de carbone HAFN.330", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },
  Tpa: { name: "Tissu polyester adhérisé", category: "1j) Caoutchouc et isolants", liste: "Liste n°1" },

  // k) Divers
  Tca: { name: "Tuyau en amiante ciment pour canalisation sous pression", category: "1k) Divers", liste: "Liste n°1" },
  Pam: { name: "Plaque en amiante ciment", category: "1k) Divers", liste: "Liste n°1" },
  Crep: { name: "Crépine", category: "1k) Divers", liste: "Liste n°1" },
  Tba: { name: "Buse en béton armé (0,6 de diamètre)", category: "1k) Divers", liste: "Liste n°1" },
  Tpe: { name: "Tuyau en polychlorure de vinyle", category: "1k) Divers", liste: "Liste n°1" },
  Tam: { name: "Élément ondulé en amiante ciment", category: "1k) Divers", liste: "Liste n°1" },
  Pc: { name: "Tube plastique \"CARIPLAST\"", category: "1k) Divers", liste: "Liste n°1" },
  Py: { name: "Polyester en plaque", category: "1k) Divers", liste: "Liste n°1" },
  Ca: { name: "Câble armé à 4 conducteurs", category: "1k) Divers", liste: "Liste n°1" },
  Lust: { name: "Lustrerie", category: "1k) Divers", liste: "Liste n°1" },
  Disj: { name: "Disjoncteurs", category: "1k) Divers", liste: "Liste n°1" },
  E: { name: "Explosif", category: "1k) Divers", liste: "Liste n°1" },
  Cr: { name: "Créosote PTT", category: "1k) Divers", liste: "Liste n°1" },
  Th: { name: "Théodolite Wild T2 complet avec trépied à branches coulissantes", category: "1k) Divers", liste: "Liste n°1" },
  Sa: { name: "Sable", category: "1k) Divers", liste: "Liste n°1" },
  Grav: { name: "Gravette", category: "1k) Divers", liste: "Liste n°1" },
  Lie: { name: "Liège", category: "1k) Divers", liste: "Liste n°1" },

  // l) Transports
  T: { name: "Transports ONT", category: "1l) Transports", liste: "Liste n°1" },
  Mtn: { name: "Transports privé par route (base 100 janvier 81)", category: "1l) Transports", liste: "Liste n°1" },
  Tv: { name: "Transport par voie ferrée", category: "1l) Transports", liste: "Liste n°1" },
  Tp: { name: "Transport maritime", category: "1l) Transports", liste: "Liste n°1" },

  // m) Matériels
  Mc2: { name: "Matériel pour terrassement aux gros engins", category: "1m) Matériels", liste: "Liste n°1" },
  Mc3: { name: "Pour travaux de terrassement", category: "1m) Matériels", liste: "Liste n°1" },
  Mc4: { name: "Pour travaux d'assainissement et de soutènement", category: "1m) Matériels", liste: "Liste n°1" },
  Mc5: { name: "Pour travaux de construction de route avec enduit superficiel ou matériaux traités au liant hydrocarboné", category: "1m) Matériels", liste: "Liste n°1" },
  Mc6: { name: "Pour travaux de renforcement ou de construction de chaussée avec enduit superficiel", category: "1m) Matériels", liste: "Liste n°1" },
  Mc7: { name: "Pour travaux de construction de renforcement de chaussée ou de couche de roulement avec matériaux traités au liant hydrocarboné", category: "1m) Matériels", liste: "Liste n°1" },
  Mc8: { name: "Pour travaux de couche de roulement avec enduit superficiel", category: "1m) Matériels", liste: "Liste n°1" },
  Mc9: { name: "Pour travaux de construction d'ouvrage d'art", category: "1m) Matériels", liste: "Liste n°1" },
  Mc10: { name: "Pour travaux de reconnaissances géologiques et géotechniques et forages d'eau", category: "1m) Matériels", liste: "Liste n°1" },
  Mc11: { name: "Pour travaux de canalisations d'eau potable", category: "1m) Matériels", liste: "Liste n°1" },

  // n) Index complexes de l'habitat économique
  Q: { name: "Quincaillerie", category: "1n) Index complexes habitat économique", liste: "Liste n°1" },
  Qal: { name: "Quincaillerie pour menuiserie aluminium", category: "1n) Index complexes habitat économique", liste: "Liste n°1" },
  CaR: { name: "Canalisations habitat type I (niveau Fer galvanisé-Fonte)", category: "1n) Index complexes habitat économique", liste: "Liste n°1" },
  CaI: { name: "Canalisations habitat type II (plusieurs niveaux Fer galvanisé-Fonte)", category: "1n) Index complexes habitat économique", liste: "Liste n°1" },
  CaL: { name: "Canalisations habitat type III (plusieurs niveaux ciment-Fonte)", category: "1n) Index complexes habitat économique", liste: "Liste n°1" },
  Ap: { name: "Appareillage électrique", category: "1n) Index complexes habitat économique", liste: "Liste n°1" },

  // o) Index global pour les terrassements ordinaires
  Mc1: { name: "Index global pour les terrassements ordinaires", category: "1o) Terrassements ordinaires", liste: "Liste n°1" },

  // ═══════════════════════════════════════════════════════════════════════════════
  // LISTE N°2 – INDEX GLOBAUX
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // A) Applicables aux Marchés d'habitat économique
  GOA: { name: "I.A Gros-œuvre Type A (Murs port aggl.)", category: "2A) Habitat économique", liste: "Liste n°2" },
  GOB: { name: "I.B Gros-œuvre Type B (Ossature BA.br.)", category: "2A) Habitat économique", liste: "Liste n°2" },
  MQ: { name: "Menuiserie-Quincaillerie", category: "2A) Habitat économique", liste: "Liste n°2" },
  "PS/CaR": { name: "Plomberie Sanitaire habitat économique d-type I", category: "2A) Habitat économique", liste: "Liste n°2" },
  "PS/II.caI": { name: "Plomberie Sanitaire habitat économique d-type II", category: "2A) Habitat économique", liste: "Liste n°2" },
  "PS/CaM": { name: "Plomberie Sanitaire habitat économique d-type III", category: "2A) Habitat économique", liste: "Liste n°2" },
  ET: { name: "Étanchéité", category: "2A) Habitat économique", liste: "Liste n°2" },
  ELI: { name: "Va. Électricité (Immeubles)", category: "2A) Habitat économique", liste: "Liste n°2" },
  ELB: { name: "Vb. Électricité (Petit bâtiments)", category: "2A) Habitat économique", liste: "Liste n°2" },
  Pv: { name: "Peinture-Vitrerie", category: "2A) Habitat économique", liste: "Liste n°2" },
  F: { name: "Ferronnerie", category: "2A) Habitat économique", liste: "Liste n°2" },
  
  // B) Bâtiments industriels
  Bpi: { name: "Bâtiments industriels – le m² couvert", category: "2B) Bâtiments industriels", liste: "Liste n°2" },

  // ═══════════════════════════════════════════════════════════════════════════════
  // LISTE N°3 – SALAIRES ET CHARGES SOCIALES
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // a) Index Salaires
  S1: { name: "Faible proportion de manœuvres payés au SMIG (base Août 1977)", category: "3a) Salaires", liste: "Liste n°3" },
  S: { name: "Proportion moyenne de manœuvres payés au SMIG (base Avril 1972)", category: "3a) Salaires", liste: "Liste n°3" },
  S2: { name: "Forte proportion de manœuvres payés au SMIG (base Août 1977)", category: "3a) Salaires", liste: "Liste n°3" },
  Sc: { name: "Salaire d'un cadre de catégorie 12B", category: "3a) Salaires", liste: "Liste n°3" },

  // b) Index Charges Sociales
  ChTp: { name: "Marchés de travaux publics (ouvrages de génie civil)", category: "3b) Charges Sociales", liste: "Liste n°3" },
  ChB: { name: "Marchés de bâtiment y compris habitat économique", category: "3b) Charges Sociales", liste: "Liste n°3" },
  ChE: { name: "Société de topographie B. d'étude", category: "3b) Charges Sociales", liste: "Liste n°3" },
  ChF: { name: "Marchés de fournitures mat. de const.", category: "3b) Charges Sociales", liste: "Liste n°3" },
  ChFm: { name: "Marchés de fournitures ordinaires mat et d'appai", category: "3b) Charges Sociales", liste: "Liste n°3" },

  // ═══════════════════════════════════════════════════════════════════════════════
  // INDEX GLOBAUX BATIMENT ET TRAVAUX PUBLICS
  // ═══════════════════════════════════════════════════════════════════════════════

  // A – TRAVAUX ROUTIERS
  TR1: { name: "Terrassements", category: "4A) Travaux Routiers", liste: "Index Globaux BTP" },
  TR2: { name: "Assainissement et soutènement", category: "4A) Travaux Routiers", liste: "Index Globaux BTP" },
  TR3: { name: "Travaux de construction de plate-forme / route avec enduit superficiel ou matériaux traités (fourniture liant non comprise)", category: "4A) Travaux Routiers", liste: "Index Globaux BTP" },
  "TR3bis": { name: "Travaux de construction de route avec enduit superficiel ou matériaux traités (y compris fourniture de liant) (*)", category: "4A) Travaux Routiers", liste: "Index Globaux BTP" },
  TR4: { name: "Travaux de renforcement ou de construction de chaussée avec enduit superficiel (fourniture liant non comprise)", category: "4A) Travaux Routiers", liste: "Index Globaux BTP" },
  "TR4bis": { name: "Travaux de renforcement ou de construction de chaussée avec enduit superficiel (y compris fourniture de liant) (*)", category: "4A) Travaux Routiers", liste: "Index Globaux BTP" },
  TR5: { name: "Travaux de construction ou renforcement de chaussée / couche de roulement avec matériaux traités (fourniture liant non comprise)", category: "4A) Travaux Routiers", liste: "Index Globaux BTP" },
  "TR5bis": { name: "Travaux de construction ou renforcement de chaussée avec matériaux traités (y compris fourniture de liant) (*)", category: "4A) Travaux Routiers", liste: "Index Globaux BTP" },
  TR6: { name: "Travaux de couche de roulement en enduit superficiel (fourniture liant non comprise)", category: "4A) Travaux Routiers", liste: "Index Globaux BTP" },
  "TR6bis": { name: "Travaux de couche de roulement en enduit superficiel (y compris fourniture de liant) (*)", category: "4A) Travaux Routiers", liste: "Index Globaux BTP" },

  // B – OUVRAGES D'ART
  OA1: { name: "Travaux de réalisation de fondations profondes", category: "4B) Ouvrages d'Art", liste: "Index Globaux BTP" },
  OA2: { name: "Travaux de construction du tablier en béton armé y compris équipements", category: "4B) Ouvrages d'Art", liste: "Index Globaux BTP" },
  OA3: { name: "Travaux de construction du tablier en béton précontraint y compris équipements", category: "4B) Ouvrages d'Art", liste: "Index Globaux BTP" },
  OA4: { name: "Travaux de construction d'un ouvrage d'art en béton armé (avec fondations profondes ou superficielles)", category: "4B) Ouvrages d'Art", liste: "Index Globaux BTP" },
  OA5: { name: "Travaux de construction d'un ouvrage d'art en béton précontraint (avec fondations profondes ou superficielles)", category: "4B) Ouvrages d'Art", liste: "Index Globaux BTP" },

  // C – BÂTIMENT
  BAT1: { name: "Gros œuvre – Revêtement – Étanchéité", category: "4C) Bâtiment", liste: "Index Globaux BTP" },
  BAT2: { name: "Menuiserie", category: "4C) Bâtiment", liste: "Index Globaux BTP" },
  BAT3: { name: "Électricité", category: "4C) Bâtiment", liste: "Index Globaux BTP" },
  BAT4: { name: "Plomberie Sanitaire", category: "4C) Bâtiment", liste: "Index Globaux BTP" },
  BAT5: { name: "Peinture vitrerie", category: "4C) Bâtiment", liste: "Index Globaux BTP" },
  BAT6: { name: "Bâtiment tous corps d'état", category: "4C) Bâtiment", liste: "Index Globaux BTP" },

  // D – RECONNAISSANCES GÉOLOGIQUES ET GÉOTECHNIQUES ET FORAGES D'EAU
  SF1: { name: "Reconnaissances géologiques et forages d'eau", category: "4D) Reconnaissances et Forages", liste: "Index Globaux BTP" },
  SF2: { name: "Sondages de reconnaissances hydrogéologiques", category: "4D) Reconnaissances et Forages", liste: "Index Globaux BTP" },
  SF3: { name: "Forages d'essai et d'exploitation", category: "4D) Reconnaissances et Forages", liste: "Index Globaux BTP" },
  SF4: { name: "Forages profonds", category: "4D) Reconnaissances et Forages", liste: "Index Globaux BTP" },
  SF5: { name: "Fonçage de puits", category: "4D) Reconnaissances et Forages", liste: "Index Globaux BTP" },
  SF6: { name: "Sondages et forages", category: "4D) Reconnaissances et Forages", liste: "Index Globaux BTP" },

  // E – CANALISATIONS ET RÉSERVOIRS D'EAU POTABLE
  CEP1: { name: "Conduites amiante ciment", category: "4E) Canalisations et Réservoirs", liste: "Index Globaux BTP" },
  CEP2: { name: "Conduites en béton armé ou précontraint", category: "4E) Canalisations et Réservoirs", liste: "Index Globaux BTP" },
  CEP3: { name: "Conduites en fonte", category: "4E) Canalisations et Réservoirs", liste: "Index Globaux BTP" },
  REP: { name: "Réservoirs d'eau potable", category: "4E) Canalisations et Réservoirs", liste: "Index Globaux BTP" },

  // F – INGÉNIERIE
  ING: { name: "Ingénierie", category: "4F) Ingénierie", liste: "Index Globaux BTP" },
};

// ═══════════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Log an action to audit log
 */
async function logAudit(
  monthDate: string,
  action: string,
  userId: string | null,
  userEmail: string | null,
  changes: any,
  source: string,
  req: Request
) {
  try {
    await pool.query(`
      INSERT INTO index_audit_log (month_date, action, user_id, user_email, changes, source, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      monthDate,
      action,
      userId,
      userEmail,
      JSON.stringify(changes),
      source,
      req.ip || req.connection?.remoteAddress,
      req.headers['user-agent']
    ]);
  } catch (error) {
    logger.error('Error logging audit:', error);
  }
}

/**
 * Parse month string to date
 */
function parseMonthToDate(month: string): string {
  // Handle formats: "2024-01", "2024-01-01", "Jan 2024"
  if (/^\d{4}-\d{2}$/.test(month)) {
    return `${month}-01`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(month)) {
    return month;
  }
  // Try to parse as date
  const date = new Date(month);
  if (!isNaN(date.getTime())) {
    return date.toISOString().substring(0, 10);
  }
  throw new Error(`Invalid month format: ${month}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════
// CONTROLLERS
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * GET /indexes/catalog - Get index catalog
 */
export const getIndexCatalog = async (req: Request, res: Response) => {
  try {
    // Group by category and liste
    const categories: Record<string, Array<{ code: string; name: string; liste?: string }>> = {};
    const listes: Record<string, Array<{ code: string; name: string; category: string }>> = {};
    
    for (const [code, info] of Object.entries(INDEX_CATALOG)) {
      // Group by category
      if (!categories[info.category]) {
        categories[info.category] = [];
      }
      categories[info.category].push({
        code,
        name: info.name,
        liste: info.liste
      });
      
      // Group by liste
      if (!listes[info.liste]) {
        listes[info.liste] = [];
      }
      listes[info.liste].push({
        code,
        name: info.name,
        category: info.category
      });
    }
    
    res.json({
      success: true,
      data: {
        catalog: INDEX_CATALOG,
        categories,
        listes,
        totalIndexes: Object.keys(INDEX_CATALOG).length
      }
    });
  } catch (error: any) {
    logger.error('Error getting catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /indexes - List all months
 */
export const listIndexes = async (req: Request, res: Response) => {
  try {
    const { year, status } = req.query;
    
    let query = `
      SELECT 
        id,
        month_date,
        jsonb_object_keys(index_values) as index_count,
        status,
        source,
        notes,
        created_at,
        updated_at
      FROM revision_indexes
    `;
    const params: any[] = [];
    const conditions: string[] = [];
    
    if (year) {
      conditions.push(`EXTRACT(YEAR FROM month_date) = $${params.length + 1}`);
      params.push(parseInt(year as string));
    }
    
    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY month_date DESC';
    
    // Get summary per month (not individual keys)
    const summaryQuery = `
      SELECT 
        id,
        month_date,
        (SELECT COUNT(*) FROM jsonb_object_keys(index_values)) as index_count,
        status,
        source,
        notes,
        created_at,
        updated_at
      FROM revision_indexes
      ${conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY month_date DESC
    `;
    
    const result = await pool.query(summaryQuery, params);
    
    // Get available years
    const yearsResult = await pool.query(`
      SELECT DISTINCT EXTRACT(YEAR FROM month_date)::integer as year
      FROM revision_indexes
      ORDER BY year DESC
    `);
    
    res.json({
      success: true,
      data: {
        months: result.rows.map(row => ({
          id: row.id,
          monthDate: row.month_date,
          indexCount: parseInt(row.index_count),
          status: row.status || 'provisoire',
          source: row.source,
          notes: row.notes,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        })),
        availableYears: yearsResult.rows.map(r => r.year),
        totalMonths: result.rows.length
      }
    });
  } catch (error: any) {
    logger.error('Error listing indexes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /indexes/:month - Get month details
 */
export const getMonthIndexes = async (req: Request, res: Response) => {
  try {
    const { month } = req.params;
    const monthDate = parseMonthToDate(month);
    
    const result = await pool.query(`
      SELECT 
        id,
        month_date,
        index_values,
        status,
        source,
        notes,
        created_at,
        updated_at,
        created_by,
        updated_by
      FROM revision_indexes
      WHERE month_date = $1
    `, [monthDate]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `No indexes found for ${month}` 
      });
    }
    
    const row = result.rows[0];
    
    // Enrich with catalog info
    const enrichedIndexes: Record<string, { value: number; name: string; category: string }> = {};
    for (const [code, value] of Object.entries(row.index_values as Record<string, number>)) {
      const info = INDEX_CATALOG[code] || { name: code, category: 'Autres' };
      enrichedIndexes[code] = {
        value: value as number,
        name: info.name,
        category: info.category
      };
    }
    
    return res.json({
      success: true,
      data: {
        id: row.id,
        monthDate: row.month_date,
        indexes: enrichedIndexes,
        rawIndexes: row.index_values,
        status: row.status || 'provisoire',
        source: row.source,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    });
  } catch (error: any) {
    logger.error('Error getting month indexes:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /indexes - Add new month
 */
export const createMonthIndexes = async (req: Request, res: Response) => {
  try {
    const { monthDate, indexes, status, source, notes } = req.body;
    const user = (req as any).user;
    
    if (!monthDate || !indexes) {
      return res.status(400).json({ 
        success: false, 
        error: 'monthDate and indexes are required' 
      });
    }
    
    const parsedDate = parseMonthToDate(monthDate);
    
    // Check if month already exists
    const existing = await pool.query(
      'SELECT id FROM revision_indexes WHERE month_date = $1',
      [parsedDate]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: `Month ${monthDate} already exists. Use PUT to update.` 
      });
    }
    
    // Insert
    const result = await pool.query(`
      INSERT INTO revision_indexes (month_date, index_values, status, source, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      parsedDate,
      JSON.stringify(indexes),
      status || 'provisoire',
      source || 'Manual entry',
      notes,
      user?.id
    ]);
    
    // Log audit
    await logAudit(
      parsedDate,
      'create',
      user?.id,
      user?.email,
      { indexes, status, source },
      'ui',
      req
    );
    
    return res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        monthDate: result.rows[0].month_date,
        indexCount: Object.keys(indexes).length,
        status: result.rows[0].status
      }
    });
  } catch (error: any) {
    logger.error('Error creating month indexes:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * PUT /indexes/:month - Update month
 */
export const updateMonthIndexes = async (req: Request, res: Response) => {
  try {
    const { month } = req.params;
    const { indexes, status, source, notes } = req.body;
    const user = (req as any).user;
    
    const monthDate = parseMonthToDate(month);
    
    // Get existing
    const existing = await pool.query(
      'SELECT * FROM revision_indexes WHERE month_date = $1',
      [monthDate]
    );
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `Month ${month} not found` 
      });
    }
    
    const oldData = existing.rows[0];
    
    // Build update
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    if (indexes !== undefined) {
      updates.push(`index_values = $${paramIndex++}`);
      params.push(JSON.stringify(indexes));
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (source !== undefined) {
      updates.push(`source = $${paramIndex++}`);
      params.push(source);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      params.push(notes);
    }
    
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    updates.push(`updated_by = $${paramIndex++}`);
    params.push(user?.id);
    
    params.push(monthDate);
    
    const result = await pool.query(`
      UPDATE revision_indexes
      SET ${updates.join(', ')}
      WHERE month_date = $${paramIndex}
      RETURNING *
    `, params);
    
    // Calculate changes for audit
    const changes: any = {};
    if (indexes) {
      // Find changed indexes
      const oldIndexes = oldData.index_values || {};
      for (const [key, value] of Object.entries(indexes as Record<string, number>)) {
        if (oldIndexes[key] !== value) {
          changes[key] = { old: oldIndexes[key], new: value };
        }
      }
    }
    if (status && status !== oldData.status) {
      changes.status = { old: oldData.status, new: status };
    }
    
    // Log audit
    await logAudit(
      monthDate,
      Object.keys(changes).includes('status') ? 'status_change' : 'update',
      user?.id,
      user?.email,
      changes,
      'ui',
      req
    );
    
    return res.json({
      success: true,
      data: {
        id: result.rows[0].id,
        monthDate: result.rows[0].month_date,
        status: result.rows[0].status,
        updatedAt: result.rows[0].updated_at
      }
    });
  } catch (error: any) {
    logger.error('Error updating month indexes:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * DELETE /indexes/:month - Delete month
 */
export const deleteMonthIndexes = async (req: Request, res: Response) => {
  try {
    const { month } = req.params;
    const user = (req as any).user;
    
    const monthDate = parseMonthToDate(month);
    
    // Get existing for audit
    const existing = await pool.query(
      'SELECT * FROM revision_indexes WHERE month_date = $1',
      [monthDate]
    );
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `Month ${month} not found` 
      });
    }
    
    // Delete
    await pool.query('DELETE FROM revision_indexes WHERE month_date = $1', [monthDate]);
    
    // Log audit
    await logAudit(
      monthDate,
      'delete',
      user?.id,
      user?.email,
      { deleted: existing.rows[0].index_values },
      'ui',
      req
    );
    
    return res.json({
      success: true,
      message: `Month ${month} deleted successfully`
    });
  } catch (error: any) {
    logger.error('Error deleting month indexes:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /indexes/template - Download Excel template
 */
export const downloadTemplate = async (req: Request, res: Response) => {
  try {
    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Template data with headers
    const headers = ['Month', 'Status', 'Source', ...Object.keys(INDEX_CATALOG)];
    
    // Example row
    const exampleRow = [
      '2025-01',
      'provisoire',
      'Bulletin officiel',
      ...Object.keys(INDEX_CATALOG).map(() => 100.0)
    ];
    
    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
    
    // Set column widths
    ws['!cols'] = [
      { wch: 12 }, // Month
      { wch: 12 }, // Status
      { wch: 20 }, // Source
      ...Object.keys(INDEX_CATALOG).map(() => ({ wch: 8 }))
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'Indexes');
    
    // Add catalog sheet for reference
    const catalogData = [
      ['Code', 'Name', 'Category'],
      ...Object.entries(INDEX_CATALOG).map(([code, info]) => [code, info.name, info.category])
    ];
    const catalogWs = XLSX.utils.aoa_to_sheet(catalogData);
    catalogWs['!cols'] = [{ wch: 8 }, { wch: 25 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, catalogWs, 'Index Catalog');
    
    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=index_template.xlsx');
    res.send(buffer);
  } catch (error: any) {
    logger.error('Error generating template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /indexes/import - Import from Excel
 */
export const importFromExcel = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { updateExisting = true } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded' 
      });
    }
    
    // Parse Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet) as any[];
    
    if (data.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Excel file is empty' 
      });
    }
    
    const results = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[]
    };
    
    for (const row of data) {
      try {
        const month = row['Month'] || row['month'] || row['month_date'];
        if (!month) {
          results.errors.push(`Row missing Month column`);
          continue;
        }
        
        const monthDate = parseMonthToDate(month);
        const status = row['Status'] || row['status'] || 'provisoire';
        const source = row['Source'] || row['source'] || 'Excel import';
        
        // Extract indexes (all columns except Month, Status, Source)
        const indexes: Record<string, number> = {};
        for (const [key, value] of Object.entries(row)) {
          if (!['Month', 'month', 'month_date', 'Status', 'status', 'Source', 'source'].includes(key)) {
            const numValue = parseFloat(value as string);
            if (!isNaN(numValue)) {
              indexes[key] = numValue;
            }
          }
        }
        
        if (Object.keys(indexes).length === 0) {
          results.errors.push(`Row ${month}: No valid indexes found`);
          continue;
        }
        
        // Check if exists
        const existing = await pool.query(
          'SELECT id FROM revision_indexes WHERE month_date = $1',
          [monthDate]
        );
        
        if (existing.rows.length > 0) {
          if (updateExisting) {
            await pool.query(`
              UPDATE revision_indexes
              SET index_values = $1, status = $2, source = $3, updated_at = CURRENT_TIMESTAMP, updated_by = $4
              WHERE month_date = $5
            `, [JSON.stringify(indexes), status, source, user?.id, monthDate]);
            results.updated++;
            
            await logAudit(monthDate, 'import', user?.id, user?.email, { indexes }, 'excel_import', req);
          } else {
            results.skipped++;
          }
        } else {
          await pool.query(`
            INSERT INTO revision_indexes (month_date, index_values, status, source, created_by)
            VALUES ($1, $2, $3, $4, $5)
          `, [monthDate, JSON.stringify(indexes), status, source, user?.id]);
          results.imported++;
          
          await logAudit(monthDate, 'import', user?.id, user?.email, { indexes }, 'excel_import', req);
        }
      } catch (error: any) {
        results.errors.push(`Row error: ${error.message}`);
      }
    }
    
    return res.json({
      success: true,
      data: results
    });
  } catch (error: any) {
    logger.error('Error importing from Excel:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /indexes/audit - Get audit log
 */
export const getAuditLog = async (req: Request, res: Response) => {
  try {
    const { month, action, limit = 100 } = req.query;
    
    let query = `
      SELECT 
        al.*,
        u.email as user_email_ref
      FROM index_audit_log al
      LEFT JOIN users u ON al.user_id = u.id
    `;
    const params: any[] = [];
    const conditions: string[] = [];
    
    if (month) {
      conditions.push(`al.month_date = $${params.length + 1}`);
      params.push(parseMonthToDate(month as string));
    }
    
    if (action) {
      conditions.push(`al.action = $${params.length + 1}`);
      params.push(action);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string));
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        monthDate: row.month_date,
        action: row.action,
        userEmail: row.user_email || row.user_email_ref,
        changes: row.changes,
        source: row.source,
        createdAt: row.created_at
      }))
    });
  } catch (error: any) {
    logger.error('Error getting audit log:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
