import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { BtpExportService } from './btp-export.service';
import type { BtpExecutionRepository } from './btp.repository';
import type { BtpTerrainRepository, DepenseRecord } from './btp-terrain.repository';

describe('BtpExportService.depenses', () => {
  it('generates an excel workbook with formatted expenses and sum formula', async () => {
    const mockExecution: Partial<BtpExecutionRepository> = {
      getProject: async (id: string) => ({
        id,
        reference: 'MAR-2026-001',
        name: 'Construction route',
        objet: 'Travaux de terrassement et chaussée',
        montantMarcheMad: 500000,
      } as any),
    };

    const mockDepenses: DepenseRecord[] = [
      {
        id: 'dep-1',
        projectId: 'proj-1',
        category: 'carburant',
        label: 'Gasoil pelle',
        amountMad: 1500,
        method: 'especes',
        reference: 'REC-101',
        spentAt: new Date('2026-09-20'),
        notes: 'Plein carburant engin',
        justificatifAssetId: null,
        saisiPar: 'Ahmed',
        createdAt: new Date('2026-09-20'),
      },
      {
        id: 'dep-2',
        projectId: 'proj-1',
        category: 'materiaux',
        label: 'Sacs de ciment',
        amountMad: 3200.5,
        method: 'cheque',
        reference: 'CHQ-8821',
        spentAt: new Date('2026-09-21'),
        notes: null,
        justificatifAssetId: null,
        saisiPar: 'Karim',
        createdAt: new Date('2026-09-21'),
      },
    ];

    const mockTerrain: Partial<BtpTerrainRepository> = {
      listDepenses: async () => mockDepenses,
    };

    const service = new BtpExportService(
      mockExecution as BtpExecutionRepository,
      mockTerrain as BtpTerrainRepository,
    );

    const streamable = await service.depenses('proj-1');
    expect(streamable).toBeDefined();

    // Verify workbook contents
    const stream = streamable.getStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheet = workbook.getWorksheet('Dépenses');
    expect(sheet).toBeDefined();

    // Check header rows
    expect(sheet?.getCell('A1').value).toContain('MAR-2026-001');
    expect(sheet?.getCell('A2').value).toBe('Travaux de terrassement et chaussée');

    // Row 5 is column header: N°, Date, Catégorie, Libellé, Paiement, Réf, Montant, Saisi par, Notes
    expect(sheet?.getCell('A5').value).toBe('N°');
    expect(sheet?.getCell('G5').value).toBe('Montant (MAD)');

    // Row 6: dep-1
    expect(sheet?.getCell('A6').value).toBe(1);
    expect(sheet?.getCell('C6').value).toBe('Carburant');
    expect(sheet?.getCell('D6').value).toBe('Gasoil pelle');
    expect(sheet?.getCell('E6').value).toBe('Espèces');
    expect(sheet?.getCell('G6').value).toBe(1500);

    // Row 7: dep-2
    expect(sheet?.getCell('A7').value).toBe(2);
    expect(sheet?.getCell('C7').value).toBe('Matériaux');
    expect(sheet?.getCell('D7').value).toBe('Sacs de ciment');
    expect(sheet?.getCell('E7').value).toBe('Chèque');
    expect(sheet?.getCell('G7').value).toBe(3200.5);

    // Row 9 is total row with SUM formula
    const totalCell = sheet?.getCell('G9');
    expect(totalCell?.value).toEqual({ formula: 'SUM(G6:G7)' });
  });
});

describe('BtpExportService.metreXlsx / metrePdf', () => {
  const periode = {
    id: 'per-2',
    projectId: 'proj-1',
    numero: 2,
    libelle: 'Période 2',
    dateDebut: new Date('2026-09-07'),
    dateFin: new Date('2026-09-30'),
    tauxTva: 20,
    tauxRetenue: 10,
    isDecompteDernier: false,
  };

  const bordereau = {
    lignes: [
      {
        id: 'bl-1',
        numero: 1,
        designation: "Projets d'exécutions, plans topographiques",
        unite: 'ENS',
        quantite: 2,
        prixUnitaire: 15000,
      },
      {
        id: 'bl-2',
        numero: 2,
        designation: 'Déblais pour ouvrages et canaux',
        unite: 'M³',
        quantite: 400,
        prixUnitaire: 45,
      },
    ],
  };

  const metreVolume = {
    id: 'm-1',
    projectId: 'proj-1',
    periodeId: 'per-2',
    bordereauLigneId: 'bl-2',
    designationBordereau: 'Déblais pour ouvrages et canaux',
    unite: 'M³',
    sections: [{ id: 'sec-1', titre: 'FDOX', ordre: 1 }],
    sousSections: [{ id: 'ss-1', sectionId: 'sec-1', titre: 'BASSIN', ordre: 1 }],
    lignes: [
      {
        id: 'l-1',
        subSectionId: 'ss-1',
        designation: 'Bassin',
        nombreSemblables: 1,
        longueur: 12.6,
        largeur: 12.6,
        profondeur: 0.6,
        partiel: 95.26,
      },
      {
        id: 'l-2',
        designation: 'Conduite',
        nombreSemblables: 1,
        longueur: 700,
        largeur: 0.4,
        profondeur: 0.4,
        partiel: 112,
      },
    ],
    totalPartiel: 230.16,
    totalCumule: 352.42,
    quantiteBordereau: 400,
    pourcentageRealisation: 88.11,
  };

  function mockRepos() {
    const execution: Partial<BtpExecutionRepository> = {
      getProject: async (id: string) =>
        ({
          id,
          reference: '87/2025/DPA/TA',
          name: 'Canalisation',
          objet: 'Travaux de canalisation et adduction',
          maitreOeuvre: 'DPA Tanger',
          montantMarcheMad: 800000,
        }) as any,
      getMetreContext: async () =>
        ({
          periode,
          bordereau,
          metres: [metreVolume],
          previousByLigne: {
            'bl-2': [{ periodeNumero: 1, totalPartiel: 122.26, lignes: [] }],
          },
        }) as any,
    };
    const terrain: Partial<BtpTerrainRepository> = {};
    return new BtpExportService(
      execution as BtpExecutionRepository,
      terrain as BtpTerrainRepository,
    );
  }

  async function loadWorkbook(streamable: { getStream(): NodeJS.ReadableStream }) {
    const chunks: Buffer[] = [];
    for await (const chunk of streamable.getStream()) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks) as any);
    return workbook;
  }

  it('génère le classeur métré avec sections, mesures, totaux et récapitulatif', async () => {
    const workbook = await loadWorkbook(await mockRepos().metreXlsx('proj-1', 'per-2'));
    const sheet = workbook.getWorksheet('Métré n°2');
    expect(sheet).toBeDefined();
    if (!sheet) return;

    // Bandeau marché
    expect(sheet.getCell('A1').value).toContain('87/2025/DPA/TA');
    expect(sheet.getCell('A1').value).toContain('MÉTRÉ N°2');

    // Prix n°1 sans métré cette période
    const prixRows: number[] = [];
    sheet.eachRow((row, n) => {
      const v = row.getCell(1).value;
      if (typeof v === 'string' && v.startsWith('PRIX N°')) prixRows.push(n);
    });
    expect(prixRows.length).toBe(2);
    expect(sheet.getCell(`A${prixRows[0]}`).value).toContain("Projets d'exécutions");
    const textsEarly: string[] = []; sheet.eachRow((row) => { const v = row.getCell(1).value; if (typeof v === 'string') textsEarly.push(v); });
    expect(textsEarly.some((v) => v.includes('Aucune mesure'))).toBe(true);

    // Prix n°2 : bandeau + section FDOX + sous-section BASSIN + 2 mesures + total
    const texts: string[] = [];
    sheet.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === 'string') texts.push(v);
    });
    expect(texts).toContain('FDOX');
    expect(texts).toContain('BASSIN');

    // Ligne de mesure « Bassin » : partiel stocké affiché tel quel
    let bassinRow: number | undefined;
    sheet.eachRow((row, n) => {
      if (row.getCell(2).value === 'Bassin') bassinRow = n;
    });
    expect(bassinRow).toBeDefined();
    expect(sheet.getCell(`F${bassinRow!}`).value).toBe(12.6);
    expect(sheet.getCell(`J${bassinRow!}`).value).toBe(95.26);

    // Ligne « Conduite » = mesure directe (sans lieu)
    expect(texts).toContain('Mesures directes');

    // Total partiel du prix = formule SUM live
    let totalFormula: unknown;
    sheet.eachRow((row) => {
      const v = row.getCell(2).value;
      if (typeof v === 'string' && v.startsWith('Total partiel')) {
        totalFormula = row.getCell(10).value;
      }
    });
    expect(totalFormula).toEqual({ formula: expect.stringMatching(/^SUM\(J\d+:J\d+\)$/) });

    // Feuille récapitulative : cumulé = précédent + période (formule live)
    const recap = workbook.getWorksheet('Récapitulatif');
    expect(recap).toBeDefined();
    expect(recap?.getCell('A5').value).toBe(1);
    expect(recap?.getCell('A6').value).toBe(2);
    expect(recap?.getCell('E6').value).toBe(122.26);
    expect(recap?.getCell('F6').value).toBe(230.16);
    expect(recap?.getCell('G6').value).toEqual({ formula: 'E6+F6', result: 352.42 });
  });

  it('génère un PDF valide avec en-tête et pagination', async () => {
    const streamable = await mockRepos().metrePdf('proj-1', 'per-2');
    const chunks: Buffer[] = [];
    for await (const chunk of streamable.getStream()) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    expect(buffer.length).toBeGreaterThan(2000);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.subarray(buffer.length - 1024).toString('latin1')).toContain('%%EOF');
    expect(streamable.options?.disposition).toContain('metre_2.pdf');
  });

  it('rejette une période inconnue', async () => {
    const execution: Partial<BtpExecutionRepository> = {
      getProject: async (id: string) => ({ id, reference: 'X', name: 'X' }) as any,
      getMetreContext: async () => null,
    };
    const service = new BtpExportService(
      execution as BtpExecutionRepository,
      {} as BtpTerrainRepository,
    );
    await expect(service.metreXlsx('proj-1', 'nope')).rejects.toThrow('Période introuvable');
    await expect(service.metrePdf('proj-1', 'nope')).rejects.toThrow('Période introuvable');
  });

  describe('attachementPdf', () => {
    const periode = {
      id: 'per-1',
      numero: 2,
      libelle: 'Août 2025',
      dateDebut: '2025-08-01T00:00:00.000Z',
      dateFin: '2025-08-31T00:00:00.000Z',
      statut: 'OUVERT',
    };

    /** Décompresse les flux de contenu (pdfkit compresse par défaut) et
     *  décode les chaînes hexadécimales des opérateurs TJ en texte lisible. */
    function pdfContentText(buffer: Buffer): string {
      const raw = buffer.toString('latin1');
      const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      const parts: string[] = [];
      let m = re.exec(raw);
      while (m) {
        try {
          const inflated = inflateSync(Buffer.from(m?.[1] ?? '', 'latin1')).toString('latin1');
          parts.push(
            inflated
              .replace(/\[([^\]]*)\]\s*TJ/g, (_full, inner: string) =>
                (inner.match(/<[0-9a-fA-F]+>/g) ?? [])
                  .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
                  .join(''),
              )
              .replace(/<([0-9a-fA-F]+)>\s*Tj/g, (_full, hex: string) =>
                Buffer.from(hex, 'hex').toString('latin1'),
              ),
          );
        } catch {
          parts.push('');
        }
        m = re.exec(raw);
      }
      return parts.join('\n');
    }

    function mockRepos(attachement: unknown): BtpExportService {
      const execution: Partial<BtpExecutionRepository> = {
        getProject: async (id: string) =>
          ({
            id,
            reference: '87/2025/DPA/TA',
            name: 'Canalisation',
            objet: 'Travaux de canalisation',
            buyerName: 'Direction Provinciale',
            annee: '2025',
            assistanceTechnique: 'Bureau d\'étude XYZ',
            maitreOeuvre: 'DPA Tanger',
            societe: 'SARL TP',
            montantMarcheMad: 800000,
          }) as never,
        getAttachement: async () => attachement as never,
      };
      return new BtpExportService(
        execution as BtpExecutionRepository,
        {} as BtpTerrainRepository,
      );
    }

    it('génère un PDF structuré avec titre provisoire et quantités formatées', async () => {
      const service = mockRepos({
        periode,
        isDernier: false,
        lignes: [
          {
            prixNo: 1,
            designation: 'Projets d’exécutions',
            unite: 'ENS',
            quantiteBordereau: 2,
            quantitePrecedente: 2,
            quantitePeriode: 0,
            quantiteCumulee: 2,
          },
          {
            prixNo: 2,
            designation: 'Déblais pour ouvrages',
            unite: 'M³',
            quantiteBordereau: 400,
            quantitePrecedente: 122.26,
            quantitePeriode: 228.56,
            quantiteCumulee: 350.82,
          },
        ],
      });
      const streamable = await service.attachementPdf('proj-1');
      const chunks: Buffer[] = [];
      for await (const chunk of streamable.getStream()) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      expect(buffer.length).toBeGreaterThan(2000);
      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(buffer.subarray(buffer.length - 1024).toString('latin1')).toContain('%%EOF');
      // Titre exact de la page web (« ATTACHEMENT PROVISOIRE N°2 »).
      expect(pdfContentText(buffer)).toContain('ATTACHEMENT PROVISOIRE');
      expect(streamable.options?.disposition).toContain('attachement_2.pdf');
    });

    it('utilise le cumul de la ligne sans le recalculer', async () => {
      const service = mockRepos({
        periode,
        isDernier: true,
        lignes: [
          {
            prixNo: 1,
            designation: 'Fourniture de béton',
            unite: 'M³',
            quantiteBordereau: 60,
            quantitePrecedente: 400,
            quantitePeriode: 6909,
            // Cumul « diffusant » : différent de précédente + période.
            quantiteCumulee: 6969,
          },
        ],
      });
      const streamable = await service.attachementPdf('proj-1');
      const chunks: Buffer[] = [];
      for await (const chunk of streamable.getStream()) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = pdfContentText(Buffer.concat(chunks));
      // Titre du bordereau final.
      expect(text).toContain('ET DERNIER');
      // fmtQty web (fr-MA) : 6.969 avec point de millier, pas 6 969,00.
      expect(text).toContain('6.969');
      expect(text).not.toContain('6 969,00');
    });

    it('rejette un attachement absent', async () => {
      const service = mockRepos(null);
      await expect(service.attachementPdf('proj-1')).rejects.toThrow(
        'attachement indisponible',
      );
    });

    it('rejette un marché introuvable', async () => {
      const execution: Partial<BtpExecutionRepository> = {
        getProject: async () => null,
      };
      const service = new BtpExportService(
        execution as BtpExecutionRepository,
        {} as BtpTerrainRepository,
      );
      await expect(service.attachementPdf('nope')).rejects.toThrow('Marché introuvable');
    });
  });
});
