import type {
  FactoryDefinition,
  FactoryDefinitionInput,
  FactoryIssue,
} from '../../shared/factories.js';
import { factoryConnectionSource } from '../../shared/factories.js';
import type { WorkItem, WorkItemConnection } from '../../shared/types.js';
import { getSettings } from './settings.service.js';
import { getActiveProvider, type WorkItemProviderService } from './workitem-provider.js';

export function validateFactoryWorkItemConnection(
  definition: FactoryDefinitionInput,
  connections: WorkItemConnection[] = getSettings().workItemConnections ?? [],
): WorkItemConnection | undefined {
  const source = definition.workItems;
  if (!source) return undefined;
  const connection = connections.find((connection) => connection.id === source.connectionId);
  const pinned = connection && factoryConnectionSource(connection);
  if (
    !pinned ||
    pinned.provider !== source.provider ||
    pinned.connectionId !== source.connectionId ||
    pinned.scope !== source.scope
  )
    throw new Error('The factory Work Item connection was removed or its pinned source changed.');
  return connection;
}

function issue(item: WorkItem, factory: FactoryDefinition): FactoryIssue {
  const source = factory.definition.workItems!;
  if (item.provider !== source.provider || !item.id || !item.url)
    throw new Error('The factory received a work item from a different source.');
  const inScope =
    source.provider === 'linear'
      ? item.extras?.team &&
        (item.extras.team as { id?: string }).id === source.scope.slice('linear:team:'.length)
      : source.provider === 'jira'
        ? item.url.startsWith(`${source.scope.slice(0, source.scope.lastIndexOf('/'))}/browse/`) &&
          item.id.startsWith(`${decodeURIComponent(source.scope.split('/').at(-1)!)}-`)
        : source.provider === 'ado'
          ? item.url.startsWith(`${source.scope}/_workitems/edit/`) ||
            item.url.startsWith(`${decodeURI(source.scope)}/_workitems/edit/`)
          : item.url.toLowerCase().startsWith(`${source.scope}/issues/`.toLowerCase());
  if (!inScope) throw new Error('The work item is outside the factory project or team.');
  if (
    item.closed === undefined ||
    !item.createdAt ||
    !Number.isFinite(Date.parse(item.createdAt)) ||
    !item.updatedAt ||
    !Number.isFinite(Date.parse(item.updatedAt))
  )
    throw new Error('The provider did not supply a valid work item lifecycle and timestamps.');
  return {
    number: item.id,
    title: item.title.slice(0, 1000),
    body: [
      item.description,
      item.acceptanceCriteria ? `Acceptance criteria:\n${item.acceptanceCriteria}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 60000),
    url: item.url,
    labels: item.tags ?? [],
    state: item.closed ? 'closed' : 'open',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** Intake uses the existing connector's credential context, never the active UI selection. */
export function createFactoryWorkItemIntake(
  dependencies: {
    connections(): WorkItemConnection[];
    provider(connectionId: string): WorkItemProviderService | null;
  } = {
    connections: () => getSettings().workItemConnections ?? [],
    provider: (connectionId) => getActiveProvider(connectionId, true),
  },
) {
  function provider(factory: FactoryDefinition) {
    const connection = validateFactoryWorkItemConnection(
      factory.definition,
      dependencies.connections(),
    );
    if (!connection) throw new Error('Choose a Work Item connection.');
    const value = dependencies.provider(connection.id);
    if (!value) throw new Error('The factory Work Item provider is unavailable.');
    return value;
  }
  async function list(factory: FactoryDefinition): Promise<FactoryIssue[]> {
    const items = await provider(factory).listItems({ factoryIntake: true });
    validateFactoryWorkItemConnection(factory.definition, dependencies.connections());
    if (items.length > 4000)
      throw new Error('Factory intake exceeded 4000 work items. Narrow the connection scope.');
    return items.map((item) => issue(item, factory));
  }
  return {
    async listIssues(factory: FactoryDefinition) {
      // Connector search indexes may lag behind their timestamps. Reconcile the complete
      // bounded scope; the durable issue key deduplicates it and runtime applies activation policy.
      return list(factory);
    },
    async readIssue(factory: FactoryDefinition, id: number | string) {
      // Re-list to establish current project/team membership and provider-specific open status.
      const item = (await list(factory)).find((item) => String(item.number) === String(id));
      if (!item) throw new Error('The work item is no longer available in the factory source.');
      return item;
    },
  };
}

export const factoryWorkItemIntake = createFactoryWorkItemIntake();
