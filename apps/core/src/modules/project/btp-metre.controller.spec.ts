import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BtpExecutionController } from './btp.module';

describe('métré HTTP boundary — déductions', () => {
  it('accepte les valeurs négatives dans tous les champs numériques saisissables', async () => {
    const saveMetres = vi.fn(async (_projectId, _periodeId, entries) => ({ entries }));
    const controller = new BtpExecutionController(
      { saveMetres } as never,
      {} as never,
      {} as never,
    );
    const body = {
      entries: [
        {
          bordereauLigneId: 'ligne-1',
          sections: [],
          sousSections: [
            { id: 'ss-1', titre: 'Déduction', nombreElements: -2 },
          ],
          lignes: [
            {
              id: 'mesure-1',
              nombreSemblables: -1,
              longueur: -2,
              largeur: -3,
              profondeur: -0.5,
              nombre: -4,
              nombreElements: -2,
              diametre: 12,
              partiel: -12,
            },
          ],
        },
      ],
    };

    await expect(controller.saveMetres('project-1', 'periode-1', body)).resolves.toEqual({
      entries: body.entries,
    });
    expect(saveMetres).toHaveBeenCalledWith('project-1', 'periode-1', body.entries);
  });
});
