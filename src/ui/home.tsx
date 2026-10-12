import { AVAILABILITY_RETENTION_DAYS, availabilityDays, collectHealth } from '../api/operations';
import { routeUrl } from '../routing/application-routes';
import type { Env } from '../types';
import { useRequestLocalization } from './document';
import { reactPageResponse } from './page';
import { versionProof } from './version-proof';

interface AvailabilityProof {
  label: 'Awaiting data' | 'Unavailable' | 'measured';
  measured: number;
  ratio?: number;
}

export interface HomePageData {
  state: string;
  availability: AvailabilityProof;
  version: ReturnType<typeof versionProof>;
}

async function currentState(env: Env): Promise<string> {
  try {
    const snapshot = await collectHealth(env, false);
    return snapshot.status;
  } catch {
    return 'unknown';
  }
}

async function measuredAvailability(env: Env): Promise<AvailabilityProof> {
  try {
    // One record per UTC day; the 365-day TTL is the retention window.
    const days = await availabilityDays(env);
    const { verified, operational, intentional } = days.reduce((total, day) => ({
      verified: total.verified + day.verified,
      operational: total.operational + day.operational,
      intentional: total.intentional + day.intentional,
    }), { verified: 0, operational: 0, intentional: 0 });
    const measured = Math.max(0, verified - intentional);
    if (!measured) return { label: 'Awaiting data', measured: 0 };
    return { label: 'measured', measured, ratio: operational / measured };
  } catch {
    return { label: 'Unavailable', measured: 0 };
  }
}

export async function loadHomePageData(env: Env): Promise<HomePageData> {
  const [state, availability] = await Promise.all([
    currentState(env),
    measuredAvailability(env),
  ]);
  return { state, availability, version: versionProof(env) };
}

function Availability({ proof }: Readonly<{ proof: AvailabilityProof }>) {
  const localization = useRequestLocalization();
  if (proof.label === 'measured' && proof.ratio !== undefined) {
    const percentage = localization.locale === localization.defaultLocale
      ? `${(proof.ratio * 100).toFixed(3)}%`
      : localization.number(proof.ratio, { style: 'percent', maximumFractionDigits: 3 });
    return <article>
      <strong>{percentage}</strong>
      <span>{localization.number(proof.measured)} measured intervals · planned offline excluded</span>
    </article>;
  }
  return <article>
    <strong>{localization.exact(proof.label)}</strong>
    <span>Scheduled observations · {AVAILABILITY_RETENTION_DAYS}-day retention</span>
  </article>;
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
      <Availability proof={data.availability} />
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
