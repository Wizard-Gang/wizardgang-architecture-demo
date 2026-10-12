import { createContext, useContext, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Env } from '../types';
import { routeUrl } from '../routing/application-routes';
import {
  primaryNavigation,
  registeredRouteMetadata,
  type RegisteredRouteMetadataView,
} from '../routing/navigation';
import { repoUrl, sourceUrl } from '../lib/github';
import { THEME_BOOT_SCRIPT } from '../lib/theme-boot';
import {
  localeNames,
  localeQueryParameter,
  supportedLocales,
  type LocalizationContext,
} from '../i18n/runtime';
import { browserAssetName, browserAssetPath } from './asset-map';
import { versionProof } from './version-proof';

const SITE_NAME = 'WizardGang Architecture Demo';
const DEFAULT_DESCRIPTION = 'A live Cloudflare architecture lab with stable task routes and demonstration fragments, executable behavior, and direct links to the public code behind it.';
const ROOT_ROUTE_ID = 'interfaces.frontend.index';

/** Acid square with an offset violet square — the same mark as the wordmark. */
const FAVICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#08080b"/><rect x="5" y="15" width="12" height="12" fill="#d9ff43"/><rect x="15" y="5" width="12" height="12" fill="#a489ff"/></svg>')}`;

export interface HeadMetadata {
  name?: string;
  property?: string;
  content: string;
}

export interface DocumentMetadata {
  title: string;
  description: string;
  headExtra?: readonly HeadMetadata[];
  lang?: string;
  dir?: 'ltr' | 'rtl';
  status?: number;
  cacheControl?: string;
  noindex?: boolean;
  canonicalPath?: string;
  routeId?: string;
}

export interface ReactPageContent extends DocumentMetadata {
  body: ReactNode;
}

export interface PageContentOptions extends Partial<Omit<DocumentMetadata, 'title' | 'description'>> {
  description?: string;
}

export { DEFAULT_DESCRIPTION, ROOT_ROUTE_ID };

const RequestLocalization = createContext<LocalizationContext | null>(null);

export function RequestLocalizationProvider({
  localization,
  children,
}: Readonly<{ localization: LocalizationContext; children: ReactNode }>) {
  return <RequestLocalization value={localization}>{children}</RequestLocalization>;
}

export function useRequestLocalization(): LocalizationContext {
  const localization = useContext(RequestLocalization);
  if (!localization) throw new Error('Document component rendered without request localization.');
  return localization;
}

function localizedRouteLabel(localization: LocalizationContext, route: RegisteredRouteMetadataView): string {
  return localization.t(`nav.${route.id}`, route.page?.label ?? route.id);
}

function DocumentHead({ content }: Readonly<{ content: ReactPageContent }>) {
  const localization = useRequestLocalization();
  const canonicalHref = new URL(content.canonicalPath ?? routeUrl(ROOT_ROUTE_ID), 'https://demo.wizardgang.ai').toString();
  const siteName = localization.t('app.title', SITE_NAME);
  const ogImageAlt = localization.t('meta.og_image_alt', 'WizardGang Architecture — Architecture you can inspect.');
  const shellStylesheetHref = routeUrl('operations.assets', { asset: browserAssetName('styles.shell') });
  const demosStylesheetHref = routeUrl('operations.assets', { asset: browserAssetName('styles.demos') });
  const socialCardHref = `https://demo.wizardgang.ai${browserAssetPath('social.card')}`;
  return <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script>{THEME_BOOT_SCRIPT}</script>
    <title>{`${content.title} · ${siteName}`}</title>
    <meta name="description" content={content.description} />
    <meta name="color-scheme" content="dark light" />
    {content.noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content={siteName} />
    <meta property="og:title" content={content.title} />
    <meta property="og:description" content={content.description} />
    <meta property="og:url" content={canonicalHref} />
    <meta property="og:image" content={socialCardHref} />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content={ogImageAlt} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content={socialCardHref} />
    <link rel="canonical" href={canonicalHref} />
    <link rel="stylesheet" href={shellStylesheetHref} />
    {content.routeId === 'demos.index' ? <link rel="stylesheet" href={demosStylesheetHref} /> : null}
    {(content.headExtra ?? []).map((metadata, index) => <meta key={`${metadata.name ?? metadata.property ?? 'meta'}-${index}`} {...metadata} />)}
    <link rel="icon" href={FAVICON} />
  </head>;
}

function PrimaryNavigation({ currentRouteId }: Readonly<{ currentRouteId?: string }>) {
  const localization = useRequestLocalization();
  return <nav className="nav" aria-label={localization.t('shell.primary_navigation', 'Primary navigation')}>
    {primaryNavigation().map((route) => <a
      key={route.id}
      href={localization.href(routeUrl(route.id))}
      aria-current={route.id === currentRouteId ? 'page' : undefined}
    >{localizedRouteLabel(localization, route)}</a>)}
  </nav>;
}

function LanguageSelector({ id = 'global-language' }: Readonly<{ id?: string }>) {
  const localization = useRequestLocalization();
  const parameter = localeQueryParameter();
  const preserved = [...localization.currentUrl.searchParams.entries()].filter(([name]) => name !== parameter);
  return <form className="language-selector" method="get" action={localization.currentUrl.pathname} data-preserve-fragment="">
    {preserved.map(([name, value], index) => <input key={`${name}-${index}`} type="hidden" name={name} value={value} />)}
    <select id={id} name={parameter} aria-label={localization.t('shell.language', 'Language')} defaultValue={localization.locale}>
      {supportedLocales.map((locale) => <option key={locale} value={locale} aria-label={localeNames[locale]}>{locale.toUpperCase()}</option>)}
    </select>
    {' '}<noscript><button type="submit">{localization.t('shell.apply_language', 'Apply')}</button></noscript>
  </form>;
}

function SiteHeader({ repositoryUrl, currentRouteId }: Readonly<{ repositoryUrl: string; currentRouteId?: string }>) {
  const localization = useRequestLocalization();
  const themeLabel = localization.t('shell.theme_toggle', 'Theme');
  return <header className="site-header">
    <a className="brand" href={localization.href(routeUrl(ROOT_ROUTE_ID))} aria-label={localization.t('shell.home', 'WizardGang Architecture Demo home')}>
      <span className="brand-mark" aria-hidden="true" />
      <span className="brand-copy"><strong>WIZARDGANG</strong></span>
    </a>
    <PrimaryNavigation currentRouteId={currentRouteId} />
    <div className="header-utilities" aria-label="Site utilities">
      <a href={repositoryUrl} aria-label={localization.t('shell.source', 'Source')}><span className="utility-label">{localization.t('shell.source', 'Source')}</span><span className="utility-icon" aria-hidden="true">↗</span></a>
      <button type="button" data-theme-toggle="" aria-label={themeLabel} aria-pressed="true"><span className="utility-label">{themeLabel}</span><span className="utility-icon" aria-hidden="true">◐</span></button>
      <noscript>
        <details className="nojs-utilities">
          <summary aria-label={`${localization.t('shell.source', 'Source')}, ${themeLabel}, ${localization.t('shell.language', 'Language')}`}>⋯</summary>
          <div className="nojs-utilities-panel">
            <a href={repositoryUrl}>{localization.t('shell.source', 'Source')} ↗</a>
            <label className="theme-nojs"><input type="checkbox" aria-label={themeLabel} /><span aria-hidden="true">◐ {themeLabel}</span></label>
            <LanguageSelector id="fallback-language" />
          </div>
        </details>
      </noscript>
      <LanguageSelector />
    </div>
  </header>;
}

function SiteFooter({ env, repositoryUrl, routeId }: Readonly<{ env: Env; repositoryUrl: string; routeId?: string }>) {
  const localization = useRequestLocalization();
  const version = versionProof(env);
  const routeSourceModule = routeId
    ? registeredRouteMetadata().find((route) => route.id === routeId)?.source.module
    : undefined;
  return <footer className="site-footer">
    <span className="site-footer-links">
      <a href={`${repositoryUrl}/security/policy`}>{localization.t('shell.security_policy', 'Security')}</a> ·{' '}
      <a href={`${repositoryUrl}/issues/new?template=bug.yml`}>{localization.t('shell.report_issue', 'Report an issue')}</a>
      {routeSourceModule ? <> · <a href={sourceUrl(env, routeSourceModule)}>{localization.t('shell.route_source', 'Route source')}<span className="sr-only">: {routeSourceModule}</span></a></> : null}
    </span>
    <span className="site-footer-build"><a href={version.href}>{version.label}</a> · <span>{version.detail}</span></span>
  </footer>;
}

function ShellBrowserModule() {
  const localization = useRequestLocalization();
  const messages = JSON.stringify({ theme: localization.t('shell.theme_toggle', 'Theme') });
  const source = routeUrl('operations.assets', { asset: browserAssetName('scripts.shell') });
  return <script type="module" src={source} data-shell-browser="" data-messages={messages} />;
}

function LocalizedDocument({ env, content, localization }: Readonly<{ env: Env; content: ReactPageContent; localization: LocalizationContext }>) {
  const repositoryUrl = repoUrl(env);
  return <html lang={content.lang ?? localization.lang} dir={content.dir ?? localization.dir}>
    <RequestLocalizationProvider localization={localization}>
      <DocumentHead content={content} />
      <body data-route-id={content.routeId}>
        <a className="skip-link" href="#main">{localization.t('shell.skip_main', 'Skip to main content')}</a>
        <SiteHeader repositoryUrl={repositoryUrl} currentRouteId={content.routeId} />
        <main className="site-main" id="main">{content.body}</main>
        <SiteFooter env={env} repositoryUrl={repositoryUrl} routeId={content.routeId} />
        <ShellBrowserModule />
      </body>
    </RequestLocalizationProvider>
  </html>;
}

export function renderDocument(env: Env, content: ReactPageContent, localization: LocalizationContext): string {
  return '<!doctype html>' + renderToStaticMarkup(<LocalizedDocument env={env} content={content} localization={localization} />);
}
