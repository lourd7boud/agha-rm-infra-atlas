import type { CompanyProfile } from './qualifier.domain';

/**
 * AGHA RM INFRA bidding profile — versioned in git; G0 reviewers may override
 * any verdict (rejected → qualified transition exists for that).
 *
 * RECORDED ASSUMPTIONS (replace with real certificate data once the
 * qualification/classification certificates are loaded into the vault):
 * - classification supports marchés up to 10 000 000 MAD estimation
 * - treasury can immobilize up to 100 000 MAD caution provisoire per bid
 * - concours (études/architecture) are out of scope — travaux company
 */
export const AGHA_PROFILE: CompanyProfile = {
  procedures: ['AOO', 'AOR', 'negocie', 'bons_de_commande'],
  maxCautionMad: 100_000,
  maxEstimationMad: 10_000_000,
  domainKeywords: [
    'irrigation',
    'hydraulique',
    'hydro-agricole',
    'eau potable',
    'aep',
    'assainissement',
    'conduite',
    'forage',
    'pompage',
    'reservoir',
    'station',
    'terrassement',
    'vrd',
    'voirie',
    'genie civil',
    'beton',
    'pont',
    'ouvrage',
    'batiment',
    'construction',
    'amenagement',
    'rehabilitation',
    'piste',
    'route',
  ],
};
