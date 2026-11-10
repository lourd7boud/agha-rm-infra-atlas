import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MetreEditor } from '../../src/app/(app)/projects/[id]/btp/MetreEditor';
import type { Metre, MetreContext } from '../../src/lib/btp-shared';
import '../../src/app/globals.css';

const initial: MetreContext = {
  periode: { id: 'test-period', projectId: 'test-project', numero: 2, libelle: null, dateDebut: '2026-10-01', dateFin: '2026-10-31', tauxTva: 20, tauxRetenue: 10, isDecompteDernier: false, statut: 'en_cours', observations: null },
  bordereau: { projectId: 'test-project', lignes: [
    { id: 'volume', numero: 1, designation: 'Déblais pour ouvrages et canaux', unite: 'M³', quantite: 10, prixUnitaire: 100, montant: 1000 },
    { id: 'steel', numero: 2, designation: 'Armatures en acier haute adhérence', unite: 'KG', quantite: 1000, prixUnitaire: 12, montant: 12000 },
    { id: 'empty', numero: 3, designation: 'Béton de propreté', unite: 'M³', quantite: 100, prixUnitaire: 900, montant: 90000 },
  ] },
  metres: [{ id: 'metre-volume', projectId: 'test-project', periodeId: 'test-period', bordereauLigneId: 'volume', designationBordereau: null, unite: 'M³', sections: [], sousSections: [], lignes: [
    { id: 'row-volume', designation: 'Semelle S1', nombreSemblables: 2, longueur: 3, largeur: 2, profondeur: 0.5 },
  ], totalPartiel: 6, totalCumule: 10, quantiteBordereau: 10, pourcentageRealisation: 100 },
  { id: 'metre-steel', projectId: 'test-project', periodeId: 'test-period', bordereauLigneId: 'steel', designationBordereau: null, unite: 'KG', sections: [], sousSections: [], lignes: [
    { id: 'row-steel', designation: 'Poteaux', nombre: 4, nombreElements: 2, longueur: 3, diametre: 12 },
  ], totalPartiel: 21.31, totalCumule: 21.31, quantiteBordereau: 1000, pourcentageRealisation: 2.131 }],
  previousByLigne: { volume: [{ periodeNumero: 1, totalPartiel: 4, lignes: [{ id: 'previous', designation: 'Historique', partiel: 4 }] }] },
};

function Fixture() {
  const [context, setContext] = useState(initial);
  const [feedback, setFeedback] = useState<'saved' | 'error'>();
  const [fail, setFail] = useState(false);
  const [payload, setPayload] = useState('');
  const [saveCount, setSaveCount] = useState(0);
  return <main className="mx-auto max-w-[1600px] p-6">
    <div className="mb-5 flex gap-6 text-xs"><span>Données de test isolées</span><label><input type="checkbox" checked={fail} onChange={(event) => setFail(event.target.checked)} /> Simuler un échec</label><output aria-label="Nombre de sauvegardes">{saveCount}</output></div>
    <MetreEditor projectId="test-project" periodeId="test-period" context={context} saveFeedback={feedback} action={async (form) => {
      setSaveCount((count) => count + 1);
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (fail) { setFeedback('error'); throw new Error('Simulated failure'); }
      const raw = String(form.get('entries'));
      const entries = JSON.parse(raw) as Pick<Metre, 'bordereauLigneId' | 'sections' | 'sousSections' | 'lignes'>[];
      setPayload(raw);
      setContext((current) => ({ ...current, metres: entries.map((entry) => ({ id: entry.bordereauLigneId, projectId: 'test-project', periodeId: 'test-period', designationBordereau: null, unite: null, totalPartiel: 0, totalCumule: 0, quantiteBordereau: 0, pourcentageRealisation: 0, ...entry })) }));
      setFeedback('saved');
    }} />
    <output aria-label="Dernière sauvegarde" hidden>{payload}</output>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
