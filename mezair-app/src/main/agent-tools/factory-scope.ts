import { factoryMatchesRemote } from '../../shared/factories.js';
import type { FactoryDefinition } from '../../shared/factories.js';

export interface ScopedRepositorySource {
  id: string;
  remoteUrl: string;
}

/** Local factories use workspace/repo IDs; remote org factories use canonical delivery identity. */
export function factoryWithinSessionScope(
  factory: FactoryDefinition,
  workspaceId: string,
  repositories: readonly ScopedRepositorySource[],
): boolean {
  if (!factory.remote) {
    return (
      factory.workspaceId === workspaceId &&
      repositories.some((repo) => repo.id === factory.definition.repoId)
    );
  }
  if (factory.definition.access.kind !== 'organization' || factory.sourceAccess !== true)
    return false;
  return repositories.some((repository) =>
    factoryMatchesRemote(factory.definition, repository.remoteUrl),
  );
}
