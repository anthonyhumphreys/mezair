import { describe, expect, it, vi } from 'vitest';
import type { FactoryDefinition } from '../../../shared/factories.js';
import {
  factoryConnectionSource,
  factoryIssueKey,
  factoryIssueLabel,
} from '../../../shared/factories.js';
import type { WorkItem, WorkItemConnection } from '../../../shared/types.js';
vi.mock('../workitem-provider.js', () => ({ getActiveProvider: vi.fn() }));
vi.mock('../settings.service.js', () => ({ getSettings: () => ({}) }));
import {
  createFactoryWorkItemIntake,
  validateFactoryWorkItemConnection,
} from '../factory-workitems.service.js';
import type { WorkItemProviderService } from '../workitem-provider.js';

const connections: WorkItemConnection[] = [
  { id: 'github', name: 'GitHub', provider: 'github', githubOwner: 'acme', githubRepo: 'app' },
  {
    id: 'ado',
    name: 'ADO',
    provider: 'ado',
    adoOrganizationUrl: 'https://dev.azure.com/acme',
    adoProject: 'App',
  },
  {
    id: 'jira',
    name: 'Jira',
    provider: 'jira',
    jiraHost: 'https://acme.atlassian.net',
    jiraProject: 'APP',
  },
  { id: 'linear', name: 'Linear', provider: 'linear', linearTeamId: 'team-1' },
];
const urls = [
  'https://github.com/acme/app/issues/1',
  'https://dev.azure.com/acme/App/_workitems/edit/1',
  'https://acme.atlassian.net/browse/APP-1',
  'https://linear.app/acme/issue/APP-1',
];
function setup(index: number) {
  let selected = structuredClone(connections[index]);
  const factory = {
    definition: {
      workItems: factoryConnectionSource(selected),
      github: {
        host: 'github.com',
        owner: 'acme',
        repo: 'delivery',
        label: '',
        baseBranch: 'main',
      },
    },
  } as FactoryDefinition;
  const item: WorkItem = {
    id: index === 0 ? urls[index] : index === 1 ? '1' : 'APP-1',
    url: urls[index],
    title: 'Fix',
    provider: selected.provider,
    state: 'Ready',
    closed: false,
    type: 'Task',
    priority: 1,
    createdAt: '2026-10-30T12:00:00Z',
    updatedAt: '2026-11-01T12:00:00Z',
    tags: [],
    description: 'Implement this',
    acceptanceCriteria: 'Pass checks',
    extras: { team: { id: 'team-1' } },
  };
  const listItems = vi.fn(async () => [item]);
  const provider = vi.fn(() => ({ listItems }) as unknown as WorkItemProviderService);
  const intake = createFactoryWorkItemIntake({ connections: () => [selected], provider });
  return {
    factory,
    item,
    intake,
    provider,
    listItems,
    change: (value: WorkItemConnection) => {
      selected = value;
    },
  };
}
describe('factory Work Item intake', () => {
  it.each([0, 1, 2, 3])(
    'uses the pinned connection and preserves the provider identity (%s)',
    async (index) => {
      const { factory, item, intake, provider, listItems } = setup(index);
      const [issue] = await intake.listIssues(factory);
      expect(issue).toMatchObject({ number: item.id, state: 'open', labels: [], url: item.url });
      expect(issue.body).toContain('Acceptance criteria:\nPass checks');
      expect(provider).toHaveBeenCalledWith(connections[index].id);
      expect(listItems).toHaveBeenCalledWith({ factoryIntake: true });
      expect((await intake.readIssue(factory, item.id)).number).toBe(item.id);
      // Full reconciliation also sees items that only became searchable after the last poll.
      expect(await intake.listIssues(factory)).toHaveLength(1);
      expect(factoryIssueLabel(issue)).toBe(index < 2 ? '#1' : 'APP-1');
    },
  );
  it('rejects a reconfigured connection before access and after an outstanding read', async () => {
    const value = setup(2);
    const changed = { ...connections[2], jiraProject: 'OTHER' };
    value.change(changed);
    await expect(value.intake.listIssues(value.factory)).rejects.toThrow('pinned source');
    expect(value.provider).not.toHaveBeenCalled();
    value.change(connections[2]);
    value.listItems.mockImplementationOnce(async () => {
      value.change(changed);
      return [value.item];
    });
    await expect(value.intake.listIssues(value.factory)).rejects.toThrow('pinned source');
  });
  it('rejects wrong projects, missing lifecycle metadata and mismatched identities', async () => {
    const { factory, item, intake } = setup(2);
    item.id = 'OTHER-1';
    await expect(intake.listIssues(factory)).rejects.toThrow('outside');
    item.id = 'APP-1';
    item.closed = undefined;
    await expect(intake.listIssues(factory)).rejects.toThrow('lifecycle');
    item.closed = true;
    expect((await intake.readIssue(factory, item.id)).state).toBe('closed');
    await expect(intake.readIssue(factory, 'APP-2')).rejects.toThrow('no longer available');
  });
  it('keeps deduplication stable across connection IDs and legacy GitHub intake', async () => {
    const { factory, intake } = setup(0);
    const [issue] = await intake.listIssues(factory);
    expect(factoryIssueKey(factory.definition, issue)).toBe('github.com/acme/app#1');
    expect(
      factoryIssueKey(
        {
          ...factory.definition,
          github: { ...factory.definition.github!, repo: 'app' },
          workItems: undefined,
        },
        { ...issue, number: 1 },
      ),
    ).toBe(factoryIssueKey(factory.definition, issue));
    const jira = setup(2);
    const [jiraIssue] = await jira.intake.listIssues(jira.factory);
    const key = factoryIssueKey(jira.factory.definition, jiraIssue);
    jira.factory.definition.workItems!.connectionId = 'another';
    expect(factoryIssueKey(jira.factory.definition, jiraIssue)).toBe(key);
    jira.factory.definition.workItems!.scope += '-other';
    expect(factoryIssueKey(jira.factory.definition, jiraIssue)).not.toBe(key);
  });
  it('requires an explicit existing connection with a bounded project/team', () => {
    expect(() => factoryConnectionSource({ ...connections[3], linearTeamId: '' })).toThrow(
      'project or team',
    );
    const { factory } = setup(3);
    expect(() => validateFactoryWorkItemConnection(factory.definition, [])).toThrow('removed');
  });
});
