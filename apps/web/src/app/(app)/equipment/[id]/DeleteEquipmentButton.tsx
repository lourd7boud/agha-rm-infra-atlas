'use client';

/**
 * Confirmation gate for the irreversible machine delete. Submitting the parent
 * server-action form destroys the machine + its whole history, so we intercept
 * the click with window.confirm — matching the codebase's convention for
 * destructive actions (e.g. tenders SearchesManager / ListsManager).
 */
export function DeleteEquipmentButton() {
  return (
    <button
      onClick={(event) => {
        if (
          !window.confirm(
            'Supprimer définitivement cette machine et TOUT son historique ' +
              '(documents, relevés compteur, bons d’intervention, plans ' +
              'd’entretien, inspections, affectations) ? Action irréversible.',
          )
        ) {
          event.preventDefault();
        }
      }}
      className="rounded-md border border-clay bg-clay-soft/40 px-4 py-2 text-sm font-semibold text-clay transition hover:bg-clay-soft/70"
    >
      Supprimer la machine
    </button>
  );
}
