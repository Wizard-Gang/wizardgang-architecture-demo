import type { CrawlerControl } from '../lib/crawler-control';
import type { DemoControl } from '../lib/demo-control';
import { sourceUrl } from '../lib/github';
import { routeUrl } from '../routing/application-routes';
import type { Env } from '../types';
import { browserAssetName } from './asset-map';
import { useRequestLocalization } from './document';
import { reactPageResponse } from './page';
import { ReferenceDetails } from './reference-details';

function ChangedBy({ value }: Readonly<{ value: string | null }>) {
  return value ? <> by {value}</> : null;
}

function AdminBrowserModule() {
  const localization = useRequestLocalization();
  const messages = JSON.stringify({
    emptyMessage: localization.exact('No public message supplied.'),
    confirm: localization.exact('Continue?'),
  });
  const source = routeUrl('operations.assets', { asset: browserAssetName('scripts.admin') });
  return <script type="module" src={source} data-admin-browser="" data-messages={messages} />;
}

export function AdminPage({
  env,
  control,
  crawlerControl,
  notice,
}: Readonly<{
  env: Env;
  control: DemoControl;
  crawlerControl: CrawlerControl;
  notice: string;
}>) {
  const localization = useRequestLocalization();
  const offline = control.state === 'offline';
  const crawlEnabled = crawlerControl.state === 'enabled';
  const adminRoute = routeUrl('operations.admin');
  const robotsRoute = routeUrl('operations.robots');
  return <>
    <section className="page-header">
      <h1>Demo Admin</h1>
      <p className="lede">Control public demo availability and ChatGPT web access without disabling the operations, security, health, recovery, or administration surfaces.</p>
      <div className="page-tools">
        <span className={`badge ${offline ? 'badge-down' : 'badge-ok'}`}>{control.state}</span>
        <ReferenceDetails links={[
          { label: 'Admin UI source', href: sourceUrl(env, 'src/ui/admin.tsx') },
          { label: 'Control logic', href: sourceUrl(env, 'src/lib/demo-control.ts') },
          { label: 'Crawler control', href: sourceUrl(env, 'src/lib/crawler-control.ts') },
          { label: 'Offline gate', href: sourceUrl(env, 'src/router.ts') },
          { label: 'Shared storage helpers', href: sourceUrl(env, 'src/lib/storage.ts') },
        ]} />
      </div>
    </section>
    {notice ? <section className="panel" role="status"><strong>{localization.exact(notice)}</strong></section> : null}
    <section className="panel">
      <h2>Public demo state</h2>
      <dl className="admin-state-details">
        <dt>Current state</dt><dd><strong>{control.state}</strong></dd>
        <dt>Last changed</dt><dd>{control.updatedAt}<ChangedBy value={control.updatedBy} /></dd>
      </dl>
      <form method="post" action={adminRoute}>
        <input type="hidden" name="control" value="demo" />
        <div className="field">
          <label htmlFor="message">Public message</label>{' '}
          <p className="subtle" id="message-help">Displayed on the offline page. Maximum 500 characters. Do not place secrets or internal incident details here.</p>{' '}
          <textarea id="message" name="message" rows={4} maxLength={500} aria-describedby="message-help" className="admin-message-input" defaultValue={control.publicMessage} />{' '}
          <aside className="offline-message-preview"><span>Public offline preview</span><strong>{localization.exact('Demo temporarily offline')}</strong><p data-offline-message-preview="">{control.publicMessage}</p></aside>{' '}
        </div>
        <div className="meta admin-state-actions">
          <button className="button-primary" name="state" value="online" type="submit" disabled={!offline}>Take demo online</button>
          {' '}
          <button name="state" value="offline" type="submit" data-confirm-change="Ordinary public demos will become unavailable and visitors will see the offline message. Continue?" disabled={offline}>Take demo offline</button>
        </div>
      </form>
    </section>
    <section className="panel" id="chatgpt-crawl">
      <p className="eyebrow">Crawler policy</p>
      <h2>ChatGPT web access</h2>
      <p><span className={`badge ${crawlEnabled ? 'badge-ok' : 'badge-down'}`}>{crawlerControl.state}</span></p>
      <p>{crawlEnabled
        ? <><strong>OAI-SearchBot</strong> and <strong>ChatGPT-User</strong> can fetch public demo routes. The ordinary demo offline gate still applies.</>
        : <><strong>OAI-SearchBot</strong> and <strong>ChatGPT-User</strong> receive a server-enforced <code>403</code> response.</>}</p>
      <p className="subtle"><strong>GPTBot remains blocked</strong>, so enabling this switch does not opt the site into foundation-model training. Search systems may take about 24 hours to observe a robots policy change.</p>
      <dl className="admin-state-details">
        <dt>Current state</dt><dd><strong>{crawlerControl.state}</strong></dd>
        <dt>Last changed</dt><dd>{crawlerControl.updatedAt}<ChangedBy value={crawlerControl.updatedBy} /></dd>
        <dt>Published policy</dt><dd><a href={robotsRoute}>Inspect <code>{robotsRoute}</code></a></dd>
        <dt>Agent reference</dt><dd><a href="https://developers.openai.com/api/docs/bots">OpenAI crawler documentation</a></dd>
      </dl>
      <form method="post" action={adminRoute}>
        <input type="hidden" name="control" value="chatgpt-crawl" />
        <div className="meta">
          <button className="button-primary" name="state" value="enabled" type="submit" disabled={crawlEnabled}>Enable ChatGPT access</button>
          {' '}
          <button name="state" value="disabled" type="submit" data-confirm-change="OAI-SearchBot and ChatGPT-User will immediately receive 403 responses. Continue?" disabled={!crawlEnabled}>Disable ChatGPT access</button>
        </div>
      </form>
    </section>
    <section className="panel">
      <h2>Offline invariants</h2>
      <ul>
        <li>Ordinary browser demo pages redirect to the public offline message.</li>
        <li>Ordinary gated API, non-HTML, and write requests return structured <code>503</code> responses.</li>
        <li>Operational machine endpoints, security, <code>{routeUrl('operations.health')}</code>, <code>{routeUrl('operations.version')}</code>, offline, admin, and required machine recovery routes remain reachable.</li>
        <li>Every state transition is written to the shared audit event stream.</li>
      </ul>
    </section>
    <AdminBrowserModule />
  </>;
}

export function renderAdmin(
  env: Env,
  control: DemoControl,
  crawlerControl: CrawlerControl,
  notice = '',
): Response {
  return reactPageResponse(env, 'Demo Admin', <AdminPage env={env} control={control} crawlerControl={crawlerControl} notice={notice} />, {
    routeId: 'operations.admin',
    cacheControl: 'no-store',
    noindex: true,
    canonicalPath: routeUrl('operations.admin'),
  });
}
