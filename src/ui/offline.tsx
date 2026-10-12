import type { DemoControl } from '../lib/demo-control';
import { repoUrl, sourceUrl } from '../lib/github';
import { routeUrl } from '../routing/application-routes';
import type { Env } from '../types';
import { useRequestLocalization } from './document';
import { reactPageResponse } from './page';

export function OfflinePage({ env, control, requestedPath }: Readonly<{ env: Env; control: DemoControl; requestedPath: string }>) {
  const localization = useRequestLocalization();
  const offline = control.state === 'offline';
  const safePath = requestedPath.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/';
  const healthRoute = routeUrl('operations.health');
  const versionRoute = routeUrl('operations.version');
  return <>
    {offline
      ? <section>
        <p className="eyebrow">Demo status / offline</p>
        <h1>{localization.t('offline.title', 'Demo temporarily offline')}</h1>
        <p className="lede">{localization.exact(control.publicMessage)}</p>
        <p className="subtle">Requested route: <code>{safePath}</code></p>
      </section>
      : <section>
        <p className="eyebrow">Demo status / online</p>
        <h1>{localization.exact('The demo is running.')}</h1>
        <p className="lede">{localization.exact(`${control.publicMessage} This page is the maintenance surface visitors see when an operator intentionally takes the demonstrations offline.`)}</p>
        <p className="subtle"><a href={localization.href(safePath)}>Continue to <code>{safePath}</code></a></p>
      </section>}
    <section className="panel">
      <h2>Still available</h2>
      <p className="subtle">Operational health and public source remain reachable during an intentional offline window.</p>
      <div className="meta">
        <a href={healthRoute}>View system health</a>
        <a href={repoUrl(env)}>Public source</a>
      </div>
      <details className="operations-inspection"><summary>Developer recovery links</summary><div className="meta"><a href={healthRoute}>Health JSON</a><a href={versionRoute}>Version JSON</a><a href={sourceUrl(env, 'docs/OPERATIONS.md')}>Operations docs ↗</a></div></details>
    </section>
  </>;
}

export function renderOffline(env: Env, control: DemoControl, requestedPath: string): Response {
  const offline = control.state === 'offline';
  return reactPageResponse(env, offline ? 'Demo offline' : 'Demo online', <OfflinePage env={env} control={control} requestedPath={requestedPath} />, {
    routeId: 'operations.offline',
    cacheControl: 'no-store',
    noindex: true,
    status: offline ? 503 : 200,
    canonicalPath: routeUrl('operations.offline'),
  });
}
