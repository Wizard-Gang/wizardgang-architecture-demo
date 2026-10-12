import { collectHealth } from '../api/operations';
import { routeUrl } from '../routing/application-routes';
import type { Env } from '../types';
import { useRequestLocalization } from './document';
import { reactPageResponse } from './page';
import { versionProof } from './version-proof';

export interface HomePageData {
  state: string;
  version: ReturnType<typeof versionProof>;
}

export async function loadHomePageData(env: Env): Promise<HomePageData> {
  let state = 'unknown';
  try {
    state = (await collectHealth(env)).status;
  } catch {
    // The homepage still renders when a dependency probe throws.
  }
  return { state, version: versionProof(env) };
}

export function HomePage({ data }: Readonly<{ data: HomePageData }>) {
  const localization = useRequestLocalization();
  const demos = localization.href(routeUrl('demos.index'));
  return <>
    <section className="page-header home-header">
      <h1>{localization.exact('Architecture')} <span>{localization.exact('you can inspect.')}</span></h1>
      <div className="home-intro">
        <p className="lede home-lede">A live Cloudflare architecture laboratory you can run, inspect, and verify against public source.</p>
      </div>
      <div className="link-row home-actions" aria-label="Primary actions">
        <a className="button-primary" href={demos}>Explore demos</a>
      </div>
    </section>
    <section className="architecture-strip home-proof-strip" aria-label="Live proof">
      <article><strong>{data.state}</strong><span>Current service state</span></article>
      <article><strong><a href={data.version.href}>{data.version.label}</a></strong><span>{data.version.detail}</span></article>
    </section>
  </>;
}

export function renderHome(env: Env, data: HomePageData): Response {
  return reactPageResponse(env, 'Architecture', <HomePage data={data} />, {
    routeId: 'interfaces.frontend.index',
    canonicalPath: routeUrl('interfaces.frontend.index'),
    description: 'A live Cloudflare architecture laboratory with executable demonstrations you can verify against public source.',
  });
}
