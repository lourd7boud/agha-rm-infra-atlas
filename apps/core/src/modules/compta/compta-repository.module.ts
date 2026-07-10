// Module feuille des repositories compta — même contrat que BtpRepositoryModule
// (Postgres obligatoire, proxy fail-fast sans DATABASE_URL).
import { Logger, Module } from '@nestjs/common';
import { getDb } from '../../db/client';
import {
  COMPTA_REPOSITORY,
  DrizzleComptaRepository,
  unavailableComptaRepository,
  type ComptaRepository,
} from './compta.repository';
import {
  COMPTA_REGISTRES_REPOSITORY,
  DrizzleComptaRegistresRepository,
  type ComptaRegistresRepository,
} from './compta-registres.repository';

const logMissingDb = (which: string) => {
  new Logger('ComptaRepositoryModule').warn(
    `DATABASE_URL not set — ${which} unavailable (compta requires Postgres)`,
  );
};

export const comptaRepositoryProvider = {
  provide: COMPTA_REPOSITORY,
  useFactory: (): ComptaRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleComptaRepository(getDb(url));
    logMissingDb('ComptaRepository');
    return unavailableComptaRepository<ComptaRepository>('ComptaRepository');
  },
};

export const comptaRegistresRepositoryProvider = {
  provide: COMPTA_REGISTRES_REPOSITORY,
  useFactory: (): ComptaRegistresRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleComptaRegistresRepository(getDb(url));
    logMissingDb('ComptaRegistresRepository');
    return unavailableComptaRepository<ComptaRegistresRepository>('ComptaRegistresRepository');
  },
};

@Module({
  providers: [comptaRepositoryProvider, comptaRegistresRepositoryProvider],
  exports: [comptaRepositoryProvider, comptaRegistresRepositoryProvider],
})
export class ComptaRepositoryModule {}
