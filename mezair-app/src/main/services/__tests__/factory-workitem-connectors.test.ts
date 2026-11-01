import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ settings: {} as Record<string, string> }));
vi.mock('../workitem-context.service.js', () => ({
  getWorkItemSettings: () => state.settings,
  getCachedWorkItems: () => null,
  getCachedWorkItem: () => null,
  cacheWorkItems: vi.fn(),
  cacheSingleWorkItem: vi.fn(),
  invalidateWorkItemsCache: vi.fn(),
  workItemConnectionKey: () => 'factory-test',
}));
import { linearProvider } from '../linear.service.js';
import { jiraProvider } from '../jira.service.js';
import { adoProvider } from '../ado.service.js';
const response = (value: unknown) => ({ ok: true, json: async () => value });
beforeEach(() => {
  state.settings = {
    linearApiKey: 'key',
    linearTeamId: 'team',
    jiraHost: 'https://acme.atlassian.net',
    jiraProject: 'APP',
    jiraEmail: 'a@acme.test',
    jiraApiToken: 'token',
    adoOrganizationUrl: 'https://dev.azure.com/acme',
    adoProject: 'App',
    adoPat: 'token',
  };
});
afterEach(() => vi.unstubAllGlobals());
describe('factory connector lifecycle and complete lists', () => {
  it('paginates Linear and uses state types rather than display names', async () => {
    const item = {
      id: 'uuid',
      identifier: 'APP-1',
      title: 'Fix',
      priority: 1,
      url: 'https://linear.app/acme/issue/APP-1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
      state: { name: 'Shipped', type: 'completed' },
      labels: { nodes: [] },
      team: { id: 'team' },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: { issues: { nodes: [item], pageInfo: { hasNextPage: true, endCursor: 'page2' } } },
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: {
            issues: {
              nodes: [
                { ...item, identifier: 'APP-2', state: { name: 'Implement', type: 'started' } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const items = await linearProvider.listItems({ factoryIntake: true });
    expect(items.map((item) => item.closed)).toEqual([true, false]);
    expect(items[0].createdAt).toBe(item.createdAt);
    expect(JSON.parse(fetch.mock.calls[1][1].body).variables.after).toBe('page2');
  });
  it('paginates Jira Cloud through enhanced search and normalizes status categories', async () => {
    const item = {
      key: 'APP-1',
      fields: {
        summary: 'Fix',
        created: '2026-01-01T00:00:00Z',
        updated: '2026-11-01T00:00:00Z',
        status: { name: 'Shipped', statusCategory: { key: 'done' } },
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ issues: [item], nextPageToken: 'page2', isLast: false }))
      .mockResolvedValueOnce(
        response({
          issues: [
            {
              ...item,
              key: 'APP-2',
              fields: {
                ...item.fields,
                status: { name: 'Working', statusCategory: { key: 'indeterminate' } },
              },
            },
          ],
          isLast: true,
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const items = await jiraProvider.listItems({ factoryIntake: true });
    expect(items.map((item) => item.closed)).toEqual([true, false]);
    expect(items[0].createdAt).toBe(item.fields.created);
    expect(fetch.mock.calls[0][0]).toContain('/rest/api/3/search/jql');
    expect(JSON.parse(fetch.mock.calls[1][1].body).nextPageToken).toBe('page2');
  });
  it('paginates Jira Server by the actual returned page size', async () => {
    state.settings.jiraAuthMode = 'server';
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ issues: [{ key: 'APP-1', fields: {} }], total: 2 }))
      .mockResolvedValueOnce(response({ issues: [{ key: 'APP-2', fields: {} }], total: 2 }));
    vi.stubGlobal('fetch', fetch);
    expect(await jiraProvider.listItems({ factoryIntake: true })).toHaveLength(2);
    expect(fetch.mock.calls[0][0]).toContain('/rest/api/2/search');
    expect(JSON.parse(fetch.mock.calls[1][1].body).startAt).toBe(1);
  });
  it('fetches all Azure DevOps batches and resolves custom completed states', async () => {
    const items = Array.from({ length: 201 }, (_, n) => ({
      id: n + 1,
      fields: {
        'System.Title': 'Fix',
        'System.WorkItemType': 'Task',
        'System.State': n ? 'Working' : 'Shipped',
        'System.CreatedDate': '2026-01-01T00:00:00Z',
        'System.ChangedDate': '2026-11-01T00:00:00Z',
      },
    }));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ workItems: items.map(({ id }) => ({ id })) }))
      .mockResolvedValueOnce(response({ value: items.slice(0, 200) }))
      .mockResolvedValueOnce(response({ value: items.slice(200) }))
      .mockResolvedValueOnce(
        response({
          value: [
            { name: 'Working', category: 'InProgress' },
            { name: 'Shipped', category: 'Completed' },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const result = await adoProvider.listItems({ factoryIntake: true });
    expect(result).toHaveLength(201);
    expect(result[0].closed).toBe(true);
    expect(result[200].closed).toBe(false);
    expect(result[0].createdAt).toBe(items[0].fields['System.CreatedDate']);
    expect(fetch.mock.calls[2][0]).toContain('ids=201&');
    expect(fetch.mock.calls[3][0]).toContain('workitemtypes/Task/states');
  });
});
