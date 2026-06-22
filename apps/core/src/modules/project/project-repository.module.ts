import { Logger, Module } from '@nestjs/common';
import { getDb } from '../../db/client';
import {
  DrizzleProjectRepository,
  InMemoryProjectRepository,
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from './project.repository';

/**
 * Leaf module that owns ONLY the PROJECT_REPOSITORY provider. It imports nothing
 * app-cyclic, so any module that just needs the project repository token
 * (people/finance/field/digest, and the cost rollup in ProjectModule itself) can
 * depend on it without pulling in ProjectModule's controller graph.
 *
 * This is what breaks the former Project ⇄ People / Project ⇄ Finance module
 * cycle: People/Finance used to import ProjectModule purely for this token, which
 * forced forwardRef() on both edges. With the token extracted here the graph is
 * acyclic and Nest can instantiate ProjectController (and its ProjectCostService)
 * deterministically — no forwardRef, no undefined injection.
 */
export const projectRepositoryProvider = {
  provide: PROJECT_REPOSITORY,
  useFactory: (): ProjectRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleProjectRepository(getDb(url));
    new Logger('ProjectRepositoryModule').warn(
      'DATABASE_URL not set — project uses a non-persistent in-memory repository',
    );
    return new InMemoryProjectRepository();
  },
};

@Module({
  providers: [projectRepositoryProvider],
  exports: [projectRepositoryProvider],
})
export class ProjectRepositoryModule {}
