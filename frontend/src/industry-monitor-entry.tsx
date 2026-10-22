import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import ChainMonitor from './ChainMonitor';

type MonitorRender = { host: HTMLElement; chainId: string; hidden: boolean };
let root: Root | null = null;
let host: HTMLElement | null = null;
const supported = new Set(['crude-oil', 'gold', 'ai-compute', 'grid', 'innovative-drugs']);
function dispose() {
  root?.unmount();
  root = null;
  host = null;
}
// Native render reuses its dedicated host. Re-rendering news/AI controls and
// entering company workspaces must not create extra roots or API requests.
window.addEventListener('industry-monitor:render', event => {
  const next = (event as CustomEvent<MonitorRender>).detail;
  if (!next?.host?.isConnected || !supported.has(next.chainId)) { dispose(); return; }
  if (host !== next.host) {
    dispose();
    host = next.host;
    root = createRoot(host);
  }
  root!.render(<ChainMonitor chainId={next.chainId} hidden={next.hidden} />);
});
window.addEventListener('industry-monitor:dispose', dispose);
// This stays a native public module, preserving its relative imports and all
// existing navigation/graph/company behavior. Register the bridge before boot.
const nativeApp = '/industry/app.js?v=ai-api-v1';
void import(/* @vite-ignore */ nativeApp);
