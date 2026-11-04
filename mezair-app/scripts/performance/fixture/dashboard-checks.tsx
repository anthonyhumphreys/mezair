import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useOverviewModuleData } from '../../../src/renderer/components/overview/useOverviewModuleData';
import type {
  OverviewModuleInstance,
  OverviewModuleRequest,
  OverviewModuleResult,
  OverviewScope,
} from '../../../src/shared/overview';

export async function checkDashboard() {
  const check = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const settle = async () => {
    await frame();
    await frame();
  };
  const requests: Array<{
    input: OverviewModuleRequest;
    resolve: (result: OverviewModuleResult) => void;
  }> = [];
  Object.defineProperty(window, 'mezair', {
    configurable: true,
    writable: true,
    value: {
      overview: {
        loadModule: (input: OverviewModuleRequest) =>
          new Promise<OverviewModuleResult>((resolve) => requests.push({ input, resolve })),
      },
    },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let scope: OverviewScope = { kind: 'workspace', workspaceId: 'a' };
  let module: OverviewModuleInstance = {
    id: 'sessions',
    type: 'sessions',
    width: 'full',
    rows: 5,
    config: {},
  };
  let data: ReturnType<typeof useOverviewModuleData>;
  function Probe() {
    data = useOverviewModuleData(scope, module, '7d', 0);
    return <p>{data.result?.source ?? 'loading'}</p>;
  }
  const render = () => flushSync(() => root.render(<Probe />));
  const result = (source: string): OverviewModuleResult => ({
    type: 'sessions',
    state: 'ready',
    rows: [],
    total: 0,
    source,
  });
  try {
    render();
    await settle();
    check(requests.length === 1, 'Dashboard should issue one initial read');
    data!.refresh();
    data!.refresh();
    check(requests.length === 2, 'Repeated forced refreshes must share one in-flight read');
    check(requests[1].input.refresh === true, 'Manual refresh must bypass a cached initial read');
    requests[1].resolve(result('fresh'));
    await settle();
    requests[0].resolve(result('stale'));
    await settle();
    check(
      host.textContent === 'fresh',
      'A stale initial response must not overwrite manual refresh',
    );
    module = { ...module, width: 'half' };
    render();
    await settle();
    check(requests.length === 2, 'Resizing a dashboard module must not refetch its data');
    scope = { kind: 'workspace', workspaceId: 'b' };
    render();
    await settle();
    check(
      requests.length === 3 && host.textContent === 'loading',
      'Workspace changes must clear old module results',
    );
    scope = { kind: 'workspace', workspaceId: 'c' };
    render();
    await settle();
    requests[2].resolve(result('wrong workspace'));
    await settle();
    check(
      host.textContent === 'loading',
      'Late responses must not leak into a different workspace',
    );
    requests[3].resolve(result('workspace c'));
    await settle();
    check(host.textContent === 'workspace c', 'The active workspace result must render');
    module = { ...module, rows: 10 };
    render();
    await settle();
    check(requests.length === 5, 'Changing row limits must reload the module');
    check(requests[4].input.module.rows === 10, 'The new row limit must reach the service');
    root.unmount();
    requests[4].resolve(result('unmounted'));
    await settle();
    check(host.textContent === '', 'A completed request must not render after unmount');
    return [
      'single initial read',
      'coalesce forced refreshes',
      'manual cache bypass',
      'reject stale refresh',
      'resize without fetching',
      'clear cross-workspace results',
      'reject old workspace response',
      'reload row limit',
      'unmounted view stays empty',
    ];
  } finally {
    if (host.childNodes.length) root.unmount();
    host.remove();
  }
}
