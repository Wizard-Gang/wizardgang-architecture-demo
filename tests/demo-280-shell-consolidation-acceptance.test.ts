import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applicationRouteRegistry, routeUrl } from '../src/routing/application-routes';
import { primaryNavigation } from '../src/routing/navigation';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

const env = {
  WG_DB: new SqliteD1(),
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
  DEPLOYED_VERSION: 'acceptance-v0.22.0',
  DEPLOYED_SHA: 'abcdef0123456789',
} as Env;

const publicPages = applicationRouteRegistry.declarations.filter((route) => (
  route.kind === 'page'
  && route.page
  && route.visibility === 'public'
  && route.methods.includes('GET')
  && !route.pattern.includes(':')
));

const retiredShellNavigationMarkers = [
  'shell-navigation',
  'breadcrumb',
  'secondary-navigation',
  'related-navigation',
] as const;

const viewportWidths = [375, 620, 760, 1024] as const;
const navigationSource = readFileSync('src/routing/navigation.ts', 'utf8');
const documentSource = readFileSync('src/ui/document.tsx', 'utf8');
const shellStyles = readFileSync('src/styles/shell.css', 'utf8');
const demoStyles = readFileSync('src/styles/demos.css', 'utf8');

function elementWithClass(html: string, tag: string, className: string): string {
  const expression = new RegExp(`<${tag}\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>[\\s\\S]*?<\\/${tag}>`);
  return html.match(expression)?.[0] ?? '';
}

function visibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function themeButton(html: string): string {
  return html.match(/<button\b[^>]*data-theme-toggle[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
}

function findOpenBrace(css: string, from: number): number {
  let quote: string | null = null;
  for (let index = from; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];
    if (!quote && char === '/' && next === '*') {
      const close = css.indexOf('*/', index + 2);
      return close === -1 ? -1 : findOpenBrace(css, close + 2);
    }
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') return index;
  }
  return -1;
}

function findMatchingBrace(css: string, open: number): number {
  let depth = 1;
  let quote: string | null = null;
  for (let index = open + 1; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];
    if (!quote && char === '/' && next === '*') {
      const close = css.indexOf('*/', index + 2);
      if (close === -1) return -1;
      index = close + 1;
      continue;
    }
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function stripComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function mediaApplies(prelude: string, width: number): boolean {
  const maxWidth = prelude.match(/max-width\s*:\s*(\d+)px/i)?.[1];
  const minWidth = prelude.match(/min-width\s*:\s*(\d+)px/i)?.[1];
  if (!maxWidth && !minWidth) return false;
  if (maxWidth && width > Number(maxWidth)) return false;
  if (minWidth && width < Number(minWidth)) return false;
  return true;
}

interface HeaderLayout {
  display: string;
  flexDirection: string;
  flexWrap: string;
}

function applyHeaderRules(css: string, width: number, state: HeaderLayout): void {
  let cursor = 0;
  while (cursor < css.length) {
    const open = findOpenBrace(css, cursor);
    if (open === -1) return;
    const close = findMatchingBrace(css, open);
    if (close === -1) throw new Error('Unbalanced stylesheet block while evaluating shell acceptance.');

    const prelude = stripComments(css.slice(cursor, open)).trim();
    const body = css.slice(open + 1, close);

    if (/^@media\b/i.test(prelude)) {
      if (mediaApplies(prelude, width)) applyHeaderRules(body, width, state);
    } else if (!prelude.startsWith('@')) {
      const targetsHeader = prelude.split(',').some((selector) => selector.trim() === '.site-header');
      if (targetsHeader) {
        for (const match of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
          const property = match[1].toLowerCase();
          const value = match[2].trim().replace(/\s*!important\s*$/i, '');
          if (property === 'display') state.display = value;
          else if (property === 'flex-direction') state.flexDirection = value;
          else if (property === 'flex-wrap') state.flexWrap = value;
        }
      }
    }

    cursor = close + 1;
  }
}

function headerLayoutAt(width: number): HeaderLayout {
  const state: HeaderLayout = { display: 'block', flexDirection: 'row', flexWrap: 'nowrap' };
  for (const css of [shellStyles, demoStyles]) applyHeaderRules(css, width, state);
  return state;
}

describe('DEMO-280 shell consolidation acceptance', () => {
  it('keeps the consolidated shell contract on every static public page', async () => {
    expect(documentSource).toContain('renderToStaticMarkup(<LocalizedDocument');
    expect(documentSource).toContain('<SiteHeader repositoryUrl={repositoryUrl} currentRouteId={content.routeId} />');
    expect(documentSource).toContain('<main className="site-main" id="main">{content.body}</main>');
    expect(documentSource).not.toContain('LegacyBody');
    const securityHref = 'https://github.com/Wizard-Gang/wizardgang-architecture-demo/security/policy';

    for (const route of publicPages) {
      const response = await route.handler(
        new Request(new URL(routeUrl(route.id), 'https://demo.wizardgang.ai')),
        { env },
        {},
      );
      const html = await response.text();
      const footer = elementWithClass(html, 'footer', 'site-footer');
      const toggle = themeButton(html);

      expect(footer, `${route.id}: footer`).not.toBe('');
      expect(footer, `${route.id}: security footer link`).toContain(`href="${securityHref}"`);
      expect(footer, `${route.id}: deployed version`).toContain(env.DEPLOYED_VERSION);
      expect(footer, `${route.id}: deployed commit`).toContain('Commit abcdef0');
      expect((html.match(/Route source/g) ?? []).length, `${route.id}: Route source count`).toBe(1);

      for (const marker of retiredShellNavigationMarkers) {
        expect(html, `${route.id}: ${marker}`).not.toContain(marker);
      }

      expect(toggle, `${route.id}: theme toggle`).not.toBe('');
      const accessibleName = toggle.match(/\baria-label="([^"]+)"/)?.[1] ?? '';
      const label = visibleText(toggle);
      expect(label.toLocaleLowerCase(), `${route.id}: theme accessible name`).toContain(accessibleName.toLocaleLowerCase());
    }
  });

  it('derives exactly Demos from primary route declarations without an allowlist', () => {
    const root = applicationRouteRegistry.declarations.find((route) => route.kind === 'page' && route.page && !route.page.parent);
    if (!root) throw new Error('Missing root page declaration.');

    const declaredPrimary = applicationRouteRegistry.declarations
      .filter((route) => (
        route.kind === 'page'
        && route.page?.navigation === 'primary'
        && route.page.parent === root.id
        && route.visibility === 'public'
        && route.methods.includes('GET')
      ))
      .sort((left, right) => (left.page?.order ?? 0) - (right.page?.order ?? 0) || left.id.localeCompare(right.id));

    const projected = primaryNavigation();
    expect(projected.map((route) => route.id)).toEqual(declaredPrimary.map((route) => route.id));
    expect(projected.map((route) => route.page?.label)).toEqual(['Demos']);

    const start = navigationSource.indexOf('export function primaryNavigation');
    const end = navigationSource.indexOf('/** Project only', start);
    const primaryProjectionSource = navigationSource.slice(start, end === -1 ? undefined : end);
    expect(primaryProjectionSource).not.toContain('demos.index');
    expect(primaryProjectionSource).not.toContain('MVP_PRODUCT_ROUTE_IDS');
  });

  it('keeps the delivered header as one non-wrapping flex row at the acceptance widths', () => {
    for (const width of viewportWidths) {
      const layout = headerLayoutAt(width);
      expect(layout.display, `${width}px display`).toBe('flex');
      expect(layout.flexDirection, `${width}px flex-direction`).toBe('row');
      expect(layout.flexWrap, `${width}px flex-wrap`).toBe('nowrap');
    }
  });

  it('keeps every stylesheet rule backed by live src/ markup or the bounded generated-class exception', () => {
    const output = execFileSync(process.execPath, ['scripts/validate-stylesheet-classes.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(output).toContain('Stylesheet class reachability OK');
  });
});
