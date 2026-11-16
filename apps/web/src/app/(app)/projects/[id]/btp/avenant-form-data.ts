import type { AvenantBordereauImpact } from '@/lib/btp-shared';

export class AvenantInputError extends Error {}

function value(entry: FormDataEntryValue | null | undefined): string {
  return typeof entry === 'string' ? entry.trim() : '';
}

function number(entry: FormDataEntryValue | null | undefined, label: string): number {
  const raw = value(entry);
  const parsed = Number(raw.replace(',', '.'));
  if (!raw || !Number.isFinite(parsed) || parsed < 0) {
    throw new AvenantInputError(`Renseignez une valeur valide pour ${label}.`);
  }
  return parsed;
}

export function parseAvenantBordereauImpact(form: FormData): AvenantBordereauImpact | undefined {
  if (form.get('avenantMode') !== 'bordereau') return;

  const currentQuantities = form.getAll('oldQuantity');
  const signedQuantities = form.getAll('newQuantity');
  const seen = new Set<string>();
  const quantities = form.getAll('quantityLine').map((entry, index) => {
    const ligneId = value(entry);
    if (!ligneId) throw new AvenantInputError('Choisissez la ligne du bordereau à modifier.');
    if (seen.has(ligneId)) throw new AvenantInputError('Modifiez chaque ligne du bordereau une seule fois.');
    seen.add(ligneId);
    const ancienneQuantite = number(currentQuantities[index], 'la quantité actuelle');
    const nouvelleQuantite = number(signedQuantities[index], 'la quantité signée');
    if (ancienneQuantite === nouvelleQuantite) {
      throw new AvenantInputError('La quantité signée doit différer de la quantité actuelle.');
    }
    return { ligneId, ancienneQuantite, nouvelleQuantite };
  });

  const designations = form.getAll('articleDesignation');
  const units = form.getAll('articleUnite');
  const articleQuantities = form.getAll('articleQuantite');
  const prices = form.getAll('articlePrixUnitaire');
  const origins = form.getAll('articleOrigine');
  const formulas = form.getAll('articleFormuleId');
  const additions: AvenantBordereauImpact['additions'] = form.getAll('articleNumero').map((entry, index) => {
    const numero = number(entry, 'le numéro du nouvel article');
    const designation = value(designations[index]);
    const unite = value(units[index]);
    const origine = value(origins[index]);
    if (!Number.isInteger(numero) || numero < 1 || !designation || !unite) {
      throw new AvenantInputError('Renseignez le numéro, la désignation et l’unité de chaque nouvel article.');
    }
    if (origine !== 'marche' && origine !== 'negocie') {
      throw new AvenantInputError('Indiquez l’origine de chaque nouveau prix selon l’avenant signé.');
    }
    const quantite = number(articleQuantities[index], 'la quantité du nouvel article');
    if (quantite === 0) throw new AvenantInputError('La quantité d’un nouvel article doit être supérieure à zéro.');
    return {
      numero, designation, unite, origine, quantite,
      prixUnitaire: number(prices[index], 'le prix unitaire du nouvel article'),
      formuleId: value(formulas[index]) || undefined,
    };
  });

  if (quantities.length + additions.length === 0) {
    throw new AvenantInputError('Ajoutez au moins une modification de quantité ou un nouvel article.');
  }
  const dateEffet = value(form.get('impactDateEffet'));
  if (!dateEffet) throw new AvenantInputError('Renseignez la date d’effet figurant sur l’avenant signé.');
  const tauxTva = number(form.get('impactTauxTva'), 'la TVA');
  if (tauxTva > 100) throw new AvenantInputError('La TVA doit être comprise entre 0 et 100 %.');
  const dateSignatureTitulaire = additions.some((article) => article.origine === 'negocie')
    ? value(form.get('impactDateSignatureTitulaire')) : undefined;
  if (dateSignatureTitulaire === '') {
    throw new AvenantInputError('Renseignez la date de signature par le titulaire pour les prix négociés.');
  }

  return {
    version: 1, dateEffet, tauxTva, quantities, additions,
    ...(dateSignatureTitulaire && { dateSignatureTitulaire }),
  };
}
