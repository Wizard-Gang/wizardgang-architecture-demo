import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import auditConfig from '../config/site-audit-states.json';
import { demonstrations } from '../src/demos/demos-page';
import { routeRequest } from '../src/router';
import { safeError } from '../src/lib/http';
import { THEME_BOOT_SCRIPT, THEME_BOOT_SHA256 } from '../src/lib/theme-boot';
import { accessibilityLabResponse } from '../src/ui/accessibility-lab';
import { localGraphiqlResponse } from '../src/ui/graphiql-response';
import {
  applicationRouteRegistry,
  routeUrl,
  type ApplicationRouteDeclaration,
} from '../src/routing/application-routes';
import type { Env } from '../src/types';
import { demoDatabase } from './helpers/wg-storage';

const ORIGIN = 'https://demo.wizardgang.ai';
const TEST_SHA = '0123456789abcdef0123456789abcdef01234567';
const SECURITY_HEADERS = [
  'content-security-policy',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'x-robots-tag',
] as const;
const PRESENTATION_SECURITY_LOCALES = ['en', 'ar'] as const;
const COMPACT_TEXT_LOCALES = ['es', 'fr', 'de', 'ja'] as const;

const EXPECTED_ENGLISH_SURFACE_IDS = [
  'page:interfaces.frontend.index',
  'page:demos.index',
  'audit:accessibility-lab',
  'audit:openapi-console',
  'audit:homepage-availability-proof',
  'page:operations.admin',
  'page:operations.offline',
  'page:ordinary-404',
  'demo:d1',
  'demo:r2',
  'demo:rest',
  'demo:graphql',
  'demo:webhooks',
  'demo:oauth',
  'demo:sso',
  'demo:saml',
  'demo:mcp',
  'demo:edge',
  'demo:workers',
  'demo:durable-objects',
  'demo:accessibility',
  'demo:i18n',
] as const;

const ENGLISH_DOCUMENT_CONTRACT = {
  'page:interfaces.frontend.index': ['interfaces.frontend.index', 'Architecture · WizardGang Architecture Demo', 'Architecture you can inspect.', 'https://demo.wizardgang.ai/'],
  'page:demos.index': ['demos.index', 'Architecture Demos · WizardGang Architecture Demo', 'Architecture Demos', 'https://demo.wizardgang.ai/demos'],
  'audit:accessibility-lab': ['demos.index', 'Architecture Demos · WizardGang Architecture Demo', 'Architecture Demos', 'https://demo.wizardgang.ai/demos'],
  'audit:openapi-console': ['demos.index', 'Architecture Demos · WizardGang Architecture Demo', 'Architecture Demos', 'https://demo.wizardgang.ai/demos'],
  'audit:homepage-availability-proof': ['interfaces.frontend.index', 'Architecture · WizardGang Architecture Demo', 'Architecture you can inspect.', 'https://demo.wizardgang.ai/'],
  'page:operations.admin': ['operations.admin', 'Demo Admin · WizardGang Architecture Demo', 'Demo Admin', 'https://demo.wizardgang.ai/admin'],
  'page:operations.offline': ['operations.offline', 'Demo online · WizardGang Architecture Demo', 'The demo is running.', 'https://demo.wizardgang.ai/offline'],
  'page:ordinary-404': [null, 'Not found · WizardGang Architecture Demo', 'That route does not exist.', 'https://demo.wizardgang.ai/'],
} as const;

const ENGLISH_FRAGMENT_CONTRACT = {
  'demo:d1': ['data-demo-section', 'd1', 'Cloudflare D1 Database'],
  'demo:r2': ['data-demo-section', 'r2', 'Cloudflare R2 Storage'],
  'demo:rest': ['data-demo-section', 'rest', 'WizardGang REST demo 1.0.0'],
  'demo:graphql': ['data-demo-section', 'graphql', 'GraphQL API'],
  'demo:webhooks': ['data-demo-section', 'webhooks', 'Signed Webhooks'],
  'demo:oauth': ['data-demo-section', 'oauth', 'OAuth 2.0'],
  'demo:sso': ['data-demo-section', 'sso', 'Single sign-on'],
  'demo:saml': ['data-demo-section', 'saml', 'SAML 2.0'],
  'demo:mcp': ['data-demo-section', 'mcp', 'Model Context Protocol'],
  'demo:edge': ['data-demo-section', 'edge', 'Cloudflare Edge'],
  'demo:workers': ['data-demo-section', 'workers', 'Cloudflare Workers'],
  'demo:durable-objects': ['data-demo-section', 'durable-objects', 'Durable Objects'],
  'demo:accessibility': ['data-demo-section', 'accessibility', 'Accessibility is behavior.'],
  'demo:i18n': ['data-demo-section', 'i18n', 'Internationalization in the interface'],
} as const;

const EXPECTED_ARABIC_SURFACE_IDS = [
  "page:interfaces.frontend.index",
  "page:demos.index",
  "audit:accessibility-lab",
  "audit:openapi-console",
  "audit:homepage-availability-proof",
  "page:operations.admin",
  "page:operations.offline",
  "page:ordinary-404",
  "demo:d1",
  "demo:r2",
  "demo:rest",
  "demo:graphql",
  "demo:webhooks",
  "demo:oauth",
  "demo:sso",
  "demo:saml",
  "demo:mcp",
  "demo:edge",
  "demo:workers",
  "demo:durable-objects",
  "demo:accessibility",
  "demo:i18n",
] as const;

const ARABIC_DOCUMENT_CONTRACT = {
  "page:interfaces.frontend.index": ["interfaces.frontend.index", "البنية · عرض بنية WizardGang", "البنية يمكنك فحصها.", "https://demo.wizardgang.ai/"],
  "page:demos.index": ["demos.index", "العروض التوضيحية للهندسة المعمارية · عرض بنية WizardGang", "العروض التوضيحية للهندسة المعمارية", "https://demo.wizardgang.ai/demos"],
  "audit:accessibility-lab": ["demos.index", "العروض التوضيحية للهندسة المعمارية · عرض بنية WizardGang", "العروض التوضيحية للهندسة المعمارية", "https://demo.wizardgang.ai/demos"],
  "audit:openapi-console": ["demos.index", "العروض التوضيحية للهندسة المعمارية · عرض بنية WizardGang", "العروض التوضيحية للهندسة المعمارية", "https://demo.wizardgang.ai/demos"],
  "audit:homepage-availability-proof": ["interfaces.frontend.index", "البنية · عرض بنية WizardGang", "البنية يمكنك فحصها.", "https://demo.wizardgang.ai/"],
  "page:operations.admin": ["operations.admin", "Demo Admin · عرض بنية WizardGang", "Demo Admin", "https://demo.wizardgang.ai/admin"],
  "page:operations.offline": ["operations.offline", "Demo online · عرض بنية WizardGang", "العرض يعمل.", "https://demo.wizardgang.ai/offline"],
  "page:ordinary-404": [null, "غير موجود · عرض بنية WizardGang", "هذا المسار غير موجود.", "https://demo.wizardgang.ai/"],
} as const;

const ARABIC_FRAGMENT_CONTRACT = {
  "demo:d1": ["data-demo-section", "d1", "قاعدة بيانات Cloudflare D1"],
  "demo:r2": ["data-demo-section", "r2", "تخزين Cloudflare R2"],
  "demo:rest": ["data-demo-section", "rest", "عرض WizardGang REST 1.0.0"],
  "demo:graphql": ["data-demo-section", "graphql", "واجهة GraphQL API"],
  "demo:webhooks": ["data-demo-section", "webhooks", "Webhooks موقّعة"],
  "demo:oauth": ["data-demo-section", "oauth", "OAuth 2.0"],
  "demo:sso": ["data-demo-section", "sso", "تسجيل الدخول الموحد"],
  "demo:saml": ["data-demo-section", "saml", "SAML 2.0"],
  "demo:mcp": ["data-demo-section", "mcp", "Model Context Protocol"],
  "demo:edge": ["data-demo-section", "edge", "حافة Cloudflare"],
  "demo:workers": ["data-demo-section", "workers", "Cloudflare Workers"],
  "demo:durable-objects": ["data-demo-section", "durable-objects", "Durable Objects"],
  "demo:accessibility": ["data-demo-section", "accessibility", "إمكانية الوصول سلوك."],
  "demo:i18n": ["data-demo-section", "i18n", "التدويل في الواجهة"],
} as const;


const COMPACT_TEXT_CONTRACT = {
  "es": {
    "name": "Spanish",
    "shell": {
      "skip": "Saltar al contenido principal",
      "navigation": "Navegación principal",
      "demos": "Demostraciones",
      "source": "Fuente",
      "theme": "Tema",
      "language": "Idioma",
      "apply": "Aplicar"
    },
    "markers": {
      "page:interfaces.frontend.index": "Arquitectura que puedes inspeccionar.",
      "page:demos.index": "Demostraciones de arquitectura",
      "audit:accessibility-lab": "Demostraciones de arquitectura",
      "audit:openapi-console": "Demostraciones de arquitectura",
      "audit:homepage-availability-proof": "Arquitectura que puedes inspeccionar.",
      "page:operations.admin": "Demo Admin",
      "page:operations.offline": "La demostración está en funcionamiento.",
      "page:ordinary-404": "Esa ruta no existe.",
      "demo:d1": "Base de datos Cloudflare D1",
      "demo:r2": "Almacenamiento Cloudflare R2",
      "demo:rest": "Demostración REST de WizardGang 1.0.0",
      "demo:graphql": "API GraphQL",
      "demo:webhooks": "Webhooks firmados",
      "demo:oauth": "OAuth 2.0",
      "demo:sso": "Inicio de sesión único",
      "demo:saml": "SAML 2.0",
      "demo:mcp": "Protocolo de Contexto de Modelo",
      "demo:edge": "Perímetro de Cloudflare",
      "demo:workers": "Cloudflare Workers",
      "demo:durable-objects": "Durable Objects",
      "demo:accessibility": "La accesibilidad es comportamiento.",
      "demo:i18n": "Internacionalización en la interfaz",
    }
  },
  "fr": {
    "name": "French",
    "shell": {
      "skip": "Aller au contenu principal",
      "navigation": "Navigation principale",
      "demos": "Démonstrations",
      "source": "Source",
      "theme": "Thème",
      "language": "Langue",
      "apply": "Appliquer"
    },
    "markers": {
      "page:interfaces.frontend.index": "Architecture que vous pouvez inspecter.",
      "page:demos.index": "Démonstrations d'architecture",
      "audit:accessibility-lab": "Démonstrations d'architecture",
      "audit:openapi-console": "Démonstrations d'architecture",
      "audit:homepage-availability-proof": "Architecture que vous pouvez inspecter.",
      "page:operations.admin": "Demo Admin",
      "page:operations.offline": "La démonstration fonctionne.",
      "page:ordinary-404": "Cette route n’existe pas.",
      "demo:d1": "Base de données Cloudflare D1",
      "demo:r2": "Stockage Cloudflare R2",
      "demo:rest": "Démo WizardGang REST 1.0.0",
      "demo:graphql": "API GraphQL",
      "demo:webhooks": "Webhooks signés",
      "demo:oauth": "OAuth 2.0",
      "demo:sso": "Authentification unique",
      "demo:saml": "SAML 2.0",
      "demo:mcp": "Model Context Protocol",
      "demo:edge": "Périphérie Cloudflare",
      "demo:workers": "Cloudflare Workers",
      "demo:durable-objects": "Durable Objects",
      "demo:accessibility": "L’accessibilité est un comportement.",
      "demo:i18n": "Internationalisation de l’interface",
    }
  },
  "de": {
    "name": "German",
    "shell": {
      "skip": "Zum Hauptinhalt springen",
      "navigation": "Hauptnavigation",
      "demos": "Demos",
      "source": "Quellcode",
      "theme": "Design",
      "language": "Sprache",
      "apply": "Anwenden"
    },
    "markers": {
      "page:interfaces.frontend.index": "Architektur zum Nachvollziehen.",
      "page:demos.index": "Architekturdemos",
      "audit:accessibility-lab": "Architekturdemos",
      "audit:openapi-console": "Architekturdemos",
      "audit:homepage-availability-proof": "Architektur zum Nachvollziehen.",
      "page:operations.admin": "Demo Admin",
      "page:operations.offline": "Die Demo läuft.",
      "page:ordinary-404": "Diese Route existiert nicht.",
      "demo:d1": "Cloudflare-D1-Datenbank",
      "demo:r2": "Cloudflare-R2-Speicher",
      "demo:rest": "WizardGang REST-Demo 1.0.0",
      "demo:graphql": "GraphQL-API",
      "demo:webhooks": "Signierte Webhooks",
      "demo:oauth": "OAuth 2.0",
      "demo:sso": "Einmaliges Anmelden",
      "demo:saml": "SAML 2.0",
      "demo:mcp": "Model Context Protocol",
      "demo:edge": "Cloudflare Edge",
      "demo:workers": "Cloudflare Workers",
      "demo:durable-objects": "Durable Objects",
      "demo:accessibility": "Barrierefreiheit ist Verhalten.",
      "demo:i18n": "Internationalisierung der Oberfläche",
    }
  },
  "ja": {
    "name": "Japanese",
    "shell": {
      "skip": "メインコンテンツへ移動",
      "navigation": "メインナビゲーション",
      "demos": "デモ",
      "source": "ソース",
      "theme": "テーマ",
      "language": "言語",
      "apply": "適用"
    },
    "markers": {
      "page:interfaces.frontend.index": "アーキテクチャ を検証できます。",
      "page:demos.index": "アーキテクチャのデモ",
      "audit:accessibility-lab": "アーキテクチャのデモ",
      "audit:openapi-console": "アーキテクチャのデモ",
      "audit:homepage-availability-proof": "アーキテクチャ を検証できます。",
      "page:operations.admin": "Demo Admin",
      "page:operations.offline": "デモは稼働中です。",
      "page:ordinary-404": "そのルートは存在しません。",
      "demo:d1": "Cloudflare D1 データベース",
      "demo:r2": "Cloudflare R2 ストレージ",
      "demo:rest": "WizardGang REST デモ 1.0.0",
      "demo:graphql": "GraphQL API",
      "demo:webhooks": "署名付き Webhook",
      "demo:oauth": "OAuth 2.0",
      "demo:sso": "シングルサインオン",
      "demo:saml": "SAML 2.0",
      "demo:mcp": "Model Context Protocol",
      "demo:edge": "Cloudflare Edge",
      "demo:workers": "Cloudflare Workers",
      "demo:durable-objects": "Durable Objects",
      "demo:accessibility": "アクセシビリティは動作です。",
      "demo:i18n": "インターフェースの国際化",
    }
  }
} as const;

const COMPACT_TEXT_FALLBACK_MARKERS = {
  "page:interfaces.frontend.index": [
    "Explore demos"
  ],
  "page:operations.admin": [
    "Demo Admin",
    "Public demo state",
    "ChatGPT web access",
    "OpenAI crawler documentation",
    "Enable ChatGPT access",
    "Disable ChatGPT access"
  ],
  "page:operations.offline": [
    "Still available",
    "Continue to /",
    "View system health",
    "Public source",
    "Health JSON",
    "Version JSON",
    "Operations docs ↗"
  ],
  "page:ordinary-404": [
    "Home",
    "Browse demos"
  ],
  "demo:rest": [
    "OpenAPI",
    "RecordInput",
    "Hello from a Worker"
  ],
  "demo:oauth": [
    "OAuth 2.0"
  ],
  "demo:saml": [
    "SAML 2.0"
  ],
  "demo:workers": [
    "Cloudflare Workers"
  ],
  "demo:durable-objects": [
    "Durable Objects"
  ],
} as const;

const NOINDEX_ARABIC_SURFACES = new Set([
  'page:operations.admin',
  'page:operations.offline',
  'page:ordinary-404',
  ...Object.keys(ARABIC_FRAGMENT_CONTRACT),
]);

const NO_REFERRER_ARABIC_SURFACES = new Set([
  'page:operations.admin',
  'page:operations.offline',
  'page:ordinary-404',
]);

const NOINDEX_ENGLISH_SURFACES = new Set([
  'page:operations.admin',
  'page:operations.offline',
  'page:ordinary-404',
  ...Object.keys(ENGLISH_FRAGMENT_CONTRACT),
]);

const NO_REFERRER_ENGLISH_SURFACES = new Set([
  'page:operations.admin',
  'page:operations.offline',
  'page:ordinary-404',
]);


function environment(): Env {
  return {
    WG_DB: demoDatabase({ crawler: 'enabled', availability: { verified: 101, operational: 99, intentional: 1 } }),
    WG_SESSION_KEY: 'presentation-session-secret-with-32-characters',
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
    DEPLOYED_VERSION: 'v0.26.0-presentation-test',
    DEPLOYED_SHA: TEST_SHA,
    DEPLOYMENT_ENVIRONMENT: 'presentation-test',
    DEPLOYMENT_CI_STATUS: 'success',
    BILLING_DEMO_MONTHLY_BUDGET_USD: '10',
  };
}

interface Surface {
  id: string;
  path: string;
  expectedStatus: number;
  authorization?: string;
}

function publicPageSurfaces(): Surface[] {
  return (applicationRouteRegistry.declarations as readonly ApplicationRouteDeclaration[])
    .filter((route) => route.kind === 'page'
      && route.visibility === 'public'
      && route.methods.includes('GET')
      && route.id !== 'operations.offline')
    .map((route) => ({
      id: `page:${route.id}`,
      path: routeUrl(route.id),
      expectedStatus: 200,
    }));
}

function surfaces(): Surface[] {
  expect(demonstrations, 'released demo presentation count').toHaveLength(14);
  const inventory = [
    ...publicPageSurfaces(),
    ...auditConfig.states.map((state) => ({
      id: `audit:${state.name}`,
      path: state.path,
      expectedStatus: 200,
    })),
    {
      id: 'page:operations.admin',
      path: routeUrl('operations.admin'),
      expectedStatus: 200,
      authorization: `Basic ${btoa('operator:test-admin-password')}`,
    },
    {
      id: 'page:operations.offline',
      path: routeUrl('operations.offline'),
      expectedStatus: 200,
    },
    {
      id: 'page:ordinary-404',
      path: '/presentation-baseline-missing',
      expectedStatus: 404,
    },
    ...demonstrations.map((demo) => ({
      id: `demo:${demo.id}`,
      path: routeUrl('demos.presentation', { demo: demo.id }),
      expectedStatus: 200,
    })),
  ];
  expect(new Set(inventory.map((surface) => surface.id)).size, 'unique surface IDs').toBe(inventory.length);
  return inventory;
}

function localizedPath(path: string, locale: string): string {
  const url = new URL(path, ORIGIN);
  if (locale === 'en') url.searchParams.delete('lang');
  else url.searchParams.set('lang', locale);
  return `${url.pathname}${url.search}${url.hash}`;
}

function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeVolatile(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .replace(/\breq_[0-9a-f]{16,}\b/gi, '<REQUEST_ID>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '<UUID>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<TIMESTAMP>')
    .replace(new RegExp(TEST_SHA, 'gi'), '<COMMIT_SHA>')
    .replace(/\b[0-9a-f]{40}\b/gi, '<COMMIT_SHA>')
    .replace(/\b\d+\.\d{3}%/g, '<AVAILABILITY_PERCENT>')
    .replace(/\b\d+ measured intervals\b/g, '<AVAILABILITY_INTERVALS> measured intervals')
    .replace(/\b(?:row|record)[ _-]?(?:id)?[ :=#-]*\d+\b/gi, (match) => match.replace(/\d+/, '<ROW_ID>'));
}

function dataAttributes(element: Element): Record<string, string> {
  return Object.fromEntries([...element.attributes]
    .filter((attribute) => attribute.name.startsWith('data-'))
    .map((attribute) => [
      attribute.name,
      attribute.name === 'data-config'
        ? `<CONFIG_SHA256:${inlineFingerprint(attribute.value)}>`
        : normalizeVolatile(attribute.value),
    ]));
}

function elementText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const ignored of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) ignored.remove();
  return normalizeVolatile(clone.textContent);
}

function referencedText(element: Element, document: Document): string {
  const references = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  return normalizeVolatile(references
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' '));
}

function authorAccessibleName(element: Element, document: Document): string {
  return referencedText(element, document)
    || normalizeVolatile(element.getAttribute('aria-label'));
}

function accessibleName(element: Element, document: Document): string {
  const authored = authorAccessibleName(element, document);
  if (authored) return authored;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) {
    const label = formLabel(element, document);
    if (label) return label;
  }
  if (element.tagName === 'IMG') return normalizeVolatile(element.getAttribute('alt'));
  if (element.tagName === 'INPUT') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (['button', 'submit', 'reset'].includes(type)) return normalizeVolatile(element.getAttribute('value'));
  }
  return elementText(element);
}

function formLabel(element: Element, document: Document): string {
  const id = element.getAttribute('id');
  const explicit = id
    ? [...document.querySelectorAll('label')].filter((label) => label.getAttribute('for') === id)
    : [];
  const wrapping = element.closest('label');
  const labels = [...explicit, ...(wrapping && !explicit.includes(wrapping) ? [wrapping] : [])];
  return normalizeVolatile(labels.map((label) => {
    const clone = label.cloneNode(true) as Element;
    for (const control of clone.querySelectorAll('input, select, textarea, button')) control.remove();
    return clone.textContent ?? '';
  }).join(' '));
}

function semanticRole(element: Element, document: Document): string | null {
  const explicit = element.getAttribute('role');
  if (explicit && ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'region', 'form', 'search'].includes(explicit)) {
    return explicit;
  }
  if (element.tagName === 'NAV') return 'navigation';
  if (element.tagName === 'MAIN') return 'main';
  if (element.tagName === 'ASIDE') return 'complementary';
  if (element.tagName === 'HEADER' && !element.parentElement?.closest('article, aside, main, nav, section')) return 'banner';
  if (element.tagName === 'FOOTER' && !element.parentElement?.closest('article, aside, main, nav, section')) return 'contentinfo';
  if (element.tagName === 'SECTION' && authorAccessibleName(element, document)) return 'region';
  if (element.tagName === 'FORM' && authorAccessibleName(element, document)) return 'form';
  return null;
}

function headingLevel(heading: Element): number | string | null {
  const ariaLevel = heading.getAttribute('aria-level');
  if (ariaLevel) return ariaLevel;
  return /^H[1-6]$/.test(heading.tagName) ? Number(heading.tagName.slice(1)) : null;
}

function inlineFingerprint(value: string): string {
  return createHash('sha256').update(normalizeVolatile(value)).digest('hex').slice(0, 16);
}

function parseDocument(html: string, url: string): { window: Window; document: Document } {
  const window = new Window({
    url,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  window.document.write(html);
  // The browser omits this fallback from the JavaScript-enabled DOM; Happy DOM
  // retains it, so remove it before taking the ordinary presentation inventory.
  window.document.querySelector('.nojs-utilities')?.closest('noscript')?.remove();
  return { window, document: window.document as unknown as Document };
}

function fullInventory(document: Document, response: Response) {
  const html = document.documentElement;
  const links = [...document.querySelectorAll('a[href]')];
  const controls = [...document.querySelectorAll('input, select, textarea')];
  const securityHeaders = Object.fromEntries(SECURITY_HEADERS
    .map((name) => [name, response.headers.get(name)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null));
  return {
    status: response.status,
    headers: {
      contentType: response.headers.get('content-type'),
      contentLanguage: response.headers.get('content-language'),
      security: securityHeaders,
    },
    document: {
      lang: html?.getAttribute('lang') ?? null,
      dir: html?.getAttribute('dir') ?? null,
      title: normalizeVolatile(document.title),
      description: normalizeVolatile(document.querySelector('meta[name="description"]')?.getAttribute('content')) || null,
      canonical: normalizeVolatile(document.querySelector('link[rel="canonical"]')?.getAttribute('href')) || null,
      openGraph: Object.fromEntries([...document.querySelectorAll('meta[property^="og:"]')]
        .map((meta) => [meta.getAttribute('property') ?? '', normalizeVolatile(meta.getAttribute('content'))])),
    },
    landmarks: [...document.querySelectorAll('header, nav, main, aside, footer, section, form, [role]')]
      .map((element) => ({ element, role: semanticRole(element, document) }))
      .filter((entry): entry is { element: Element; role: string } => Boolean(entry.role))
      .map(({ element, role }) => ({
        role,
        name: authorAccessibleName(element, document) || null,
        id: element.getAttribute('id'),
      })),
    headings: [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].map((heading) => ({
      level: headingLevel(heading),
      text: accessibleName(heading, document),
      id: heading.getAttribute('id'),
    })),
    links: links.map((link) => ({
      name: accessibleName(link, document),
      href: normalizeVolatile(link.getAttribute('href')),
      target: link.getAttribute('target'),
    })),
    buttons: [...document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]')]
      .map((button) => ({
        name: accessibleName(button, document),
        type: button.getAttribute('type') ?? (button.tagName === 'BUTTON' ? 'submit' : 'text'),
        value: normalizeVolatile(button.getAttribute('value')) || null,
      })),
    formControls: controls.map((control) => ({
      element: control.tagName.toLowerCase(),
      type: control.getAttribute('type'),
      label: formLabel(control, document) || null,
      accessibleName: accessibleName(control, document) || null,
      name: control.getAttribute('name'),
      value: normalizeVolatile((control as HTMLInputElement).value) || null,
    })),
    ids: [...document.querySelectorAll('[id]')].map((element) => element.getAttribute('id')),
    fragmentTargets: links.flatMap((link) => {
      const href = link.getAttribute('href');
      if (!href || !href.includes('#')) return [];
      const target = new URL(href, document.URL);
      const current = new URL(document.URL);
      if (target.origin !== current.origin || target.pathname !== current.pathname || !target.hash) return [];
      const fragment = decodeURIComponent(target.hash.slice(1));
      return [{ href: normalizeVolatile(href), fragment, present: Boolean(document.getElementById(fragment)) }];
    }),
    dataHooks: [...document.querySelectorAll('*')]
      .map((element) => ({
        element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`,
        attributes: dataAttributes(element),
      }))
      .filter((entry) => Object.keys(entry.attributes).length > 0),
    scripts: [...document.querySelectorAll('script')].map((script) => ({
      src: normalizeVolatile(script.getAttribute('src')) || null,
      type: script.getAttribute('type') || 'classic',
      async: script.hasAttribute('async'),
      defer: script.hasAttribute('defer'),
      inlineSha256: script.hasAttribute('src') ? null : inlineFingerprint(script.textContent ?? ''),
      data: dataAttributes(script),
    })),
    stylesheets: [
      ...[...document.querySelectorAll('link[rel~="stylesheet"]')].map((link) => ({
        kind: 'link',
        href: normalizeVolatile(link.getAttribute('href')),
        media: link.getAttribute('media'),
        inlineSha256: null,
        data: dataAttributes(link),
      })),
      ...[...document.querySelectorAll('style')].map((style) => ({
        kind: 'inline',
        href: null,
        media: style.getAttribute('media'),
        inlineSha256: inlineFingerprint(style.textContent ?? ''),
        data: dataAttributes(style),
      })),
    ],
  };
}

function textInventory(document: Document) {
  const named = [...document.querySelectorAll('a, button, input, select, textarea, nav, aside, form, [role="tab"], [role="dialog"], [role="region"], [role="tabpanel"]')]
    .map((element) => ({
      element: element.tagName.toLowerCase(),
      role: element.getAttribute('role') ?? semanticRole(element, document),
      name: accessibleName(element, document),
    }))
    .filter((entry) => entry.name);
  return {
    headings: [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].map((heading) => ({
      level: headingLevel(heading),
      text: accessibleName(heading, document),
    })),
    accessibleNames: named,
    labels: [...document.querySelectorAll('input, select, textarea')].map((control) => ({
      name: control.getAttribute('name'),
      label: formLabel(control, document) || null,
    })),
  };
}

async function renderSurface(surface: Surface, locale: string) {
  const path = localizedPath(surface.path, locale);
  const headers = new Headers({ accept: 'text/html' });
  if (surface.authorization) headers.set('authorization', surface.authorization);
  const response = await routeRequest(new Request(new URL(path, ORIGIN), { headers }), environment(), { adminAuthorized: Boolean(surface.authorization) });
  expect(response.status, `${surface.id} ${locale}`).toBe(surface.expectedStatus);
  const html = await response.text();
  const parsed = parseDocument(html, new URL(path, ORIGIN).toString());
  return { response, ...parsed };
}

async function localeInventory(locale: string, mode: 'full' | 'text') {
  const inventory: Record<string, unknown> = {};
  for (const surface of surfaces()) {
    const { response, window, document } = await renderSurface(surface, locale);
    try {
      inventory[surface.id] = mode === 'full'
        ? fullInventory(document, response)
        : textInventory(document);
    } finally {
      await window.happyDOM.close();
    }
  }
  return inventory;
}

/**
 * Update an accepted entry with:
 *   npx vitest run tests/presentation-baseline.test.ts -u
 *
 * Review the semantic diff instead of accepting the files wholesale. Every baseline
 * update requires its presentation difference and reason in the controlled record.
 */
describe('DEMO-325 presentation acceptance baseline', () => {
  it('keeps the English presentation contract compact and deterministic', async () => {
    expect(existsSync(new URL('./fixtures/presentation-baseline/en.json', import.meta.url))).toBe(false);

    const englishSurfaces = surfaces();
    expect(englishSurfaces.map((surface) => surface.id)).toEqual(EXPECTED_ENGLISH_SURFACE_IDS);

    for (const surface of englishSurfaces) {
      const { response, window, document } = await renderSurface(surface, 'en');
      try {
        expect(response.headers.get('content-type'), surface.id).toContain('text/html');

        const csp = response.headers.get('content-security-policy') ?? '';
        expect(csp, surface.id).toContain("default-src 'self'");
        expect(csp, surface.id).toContain("base-uri 'none'");
        expect(csp, surface.id).toContain("frame-ancestors 'none'");
        expect(csp, surface.id).toContain("object-src 'none'");
        expect(csp, surface.id).toContain("style-src 'self'");
        expect(csp, surface.id).not.toContain("'unsafe-inline'");
        expect(response.headers.get('cross-origin-resource-policy'), surface.id).toBe('same-origin');
        expect(response.headers.get('referrer-policy'), surface.id).toBe(
          NO_REFERRER_ENGLISH_SURFACES.has(surface.id) ? 'no-referrer' : 'strict-origin-when-cross-origin',
        );
        expect(response.headers.get('x-content-type-options'), surface.id).toBe('nosniff');
        expect(response.headers.get('x-frame-options'), surface.id).toBe('DENY');
        expect(response.headers.get('x-robots-tag'), surface.id).toBe(
          NOINDEX_ENGLISH_SURFACES.has(surface.id) ? 'noindex, nofollow' : null,
        );

        const documentContract = ENGLISH_DOCUMENT_CONTRACT[surface.id as keyof typeof ENGLISH_DOCUMENT_CONTRACT];
        if (documentContract) {
          const [routeId, title, heading, canonical] = documentContract;
          expect(response.headers.get('content-language'), surface.id).toBe(
            surface.id === 'page:ordinary-404' ? null : 'en',
          );
          expect(document.documentElement.getAttribute('lang'), surface.id).toBe('en');
          expect(document.documentElement.getAttribute('dir'), surface.id).toBe('ltr');
          expect(document.title, surface.id).toBe(title);
          expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), surface.id).toBe(canonical);
          expect(accessibleName(document.querySelector('h1')!, document), surface.id).toBe(heading);
          expect(document.querySelector('main#main'), surface.id).not.toBeNull();
          expect(document.querySelector('nav[aria-label="Primary navigation"]'), surface.id).not.toBeNull();
          expect(document.querySelector('a.skip-link[href="#main"]')?.textContent, surface.id).toContain('Skip to main content');
          expect([...document.querySelectorAll('a[href]')].some((link) => (
            accessibleName(link, document) === 'Source'
            && link.getAttribute('href') === 'https://github.com/Wizard-Gang/wizardgang-architecture-demo'
          )), surface.id).toBe(true);
          if (routeId) expect(document.body.getAttribute('data-route-id'), surface.id).toBe(routeId);
        } else {
          const fragmentContract = ENGLISH_FRAGMENT_CONTRACT[surface.id as keyof typeof ENGLISH_FRAGMENT_CONTRACT];
          expect(fragmentContract, surface.id + ' compact contract').toBeDefined();
          const [attribute, value, marker] = fragmentContract!;
          expect(response.headers.get('content-language'), surface.id).toBeNull();
          expect(document.querySelector('[' + attribute + '="' + value + '"]'), surface.id).not.toBeNull();
          expect(normalizeWhitespace(document.body.textContent), surface.id).toContain(marker);
          expect(document.title, surface.id).toBe('');
          expect(document.querySelector('link[rel="canonical"]'), surface.id).toBeNull();
        }
      } finally {
        await window.happyDOM.close();
      }
    }
  }, 60_000);

  it('keeps the Arabic presentation contract compact, RTL-aware, and deterministic', async () => {
    expect(existsSync(new URL('./fixtures/presentation-baseline/ar.json', import.meta.url))).toBe(false);

    const arabicSurfaces = surfaces();
    expect(arabicSurfaces.map((surface) => surface.id)).toEqual(EXPECTED_ARABIC_SURFACE_IDS);

    for (const surface of arabicSurfaces) {
      const { response, window, document } = await renderSurface(surface, 'ar');
      try {
        expect(response.headers.get('content-type'), surface.id).toContain('text/html');

        const csp = response.headers.get('content-security-policy') ?? '';
        expect(csp, surface.id).toContain("default-src 'self'");
        expect(csp, surface.id).toContain("base-uri 'none'");
        expect(csp, surface.id).toContain("frame-ancestors 'none'");
        expect(csp, surface.id).toContain("object-src 'none'");
        expect(csp, surface.id).toContain("style-src 'self'");
        expect(csp, surface.id).not.toContain("'unsafe-inline'");
        expect(response.headers.get('cross-origin-resource-policy'), surface.id).toBe('same-origin');
        expect(response.headers.get('referrer-policy'), surface.id).toBe(
          NO_REFERRER_ARABIC_SURFACES.has(surface.id) ? 'no-referrer' : 'strict-origin-when-cross-origin',
        );
        expect(response.headers.get('x-content-type-options'), surface.id).toBe('nosniff');
        expect(response.headers.get('x-frame-options'), surface.id).toBe('DENY');
        expect(response.headers.get('x-robots-tag'), surface.id).toBe(
          NOINDEX_ARABIC_SURFACES.has(surface.id) ? 'noindex, nofollow' : null,
        );

        const documentContract = ARABIC_DOCUMENT_CONTRACT[surface.id as keyof typeof ARABIC_DOCUMENT_CONTRACT];
        if (documentContract) {
          const [routeId, title, heading, canonical] = documentContract;
          expect(response.headers.get('content-language'), surface.id).toBe(
            surface.id === 'page:ordinary-404' ? null : 'ar',
          );
          expect(document.documentElement.getAttribute('lang'), surface.id).toBe('ar');
          expect(document.documentElement.getAttribute('dir'), surface.id).toBe('rtl');
          expect(document.title, surface.id).toBe(title);
          expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), surface.id).toBe(canonical);
          expect(accessibleName(document.querySelector('h1')!, document), surface.id).toBe(heading);
          expect(document.querySelector('main#main'), surface.id).not.toBeNull();
          expect(document.querySelector('nav[aria-label="التنقل الرئيسي"]'), surface.id).not.toBeNull();
          expect(document.querySelector('a.skip-link[href="#main"]')?.textContent, surface.id).toContain('انتقل إلى المحتوى الرئيسي');
          expect(document.querySelector('select[name="lang"][aria-label="اللغة"] option[value="ar"][selected]'), surface.id).not.toBeNull();
          expect(document.querySelector('button[data-theme-toggle][aria-label="السمة"]'), surface.id).not.toBeNull();
          expect([...document.querySelectorAll('a[href]')].some((link) => (
            accessibleName(link, document) === 'المصدر'
            && link.getAttribute('href') === 'https://github.com/Wizard-Gang/wizardgang-architecture-demo'
          )), surface.id).toBe(true);
          expect(document.title, surface.id).toContain('WizardGang');
          if (routeId) expect(document.body.getAttribute('data-route-id'), surface.id).toBe(routeId);
        } else {
          const fragmentContract = ARABIC_FRAGMENT_CONTRACT[surface.id as keyof typeof ARABIC_FRAGMENT_CONTRACT];
          expect(fragmentContract, surface.id + ' compact contract').toBeDefined();
          const [attribute, value, marker] = fragmentContract!;
          expect(response.headers.get('content-language'), surface.id).toBeNull();
          expect(document.querySelector('[' + attribute + '="' + value + '"]'), surface.id).not.toBeNull();
          expect(normalizeWhitespace(document.body.textContent), surface.id).toContain(marker);
          expect(normalizeWhitespace(document.body.textContent), surface.id).toMatch(/[\u0600-\u06ff]/);
          expect(document.title, surface.id).toBe('');
          expect(document.querySelector('link[rel="canonical"]'), surface.id).toBeNull();

          if (surface.id === 'demo:i18n') {
            expect(document.querySelector('input[type="hidden"][name="lang"][value="ar"]'), surface.id).not.toBeNull();
          }
        }
      } finally {
        await window.happyDOM.close();
      }
    }
  }, 60_000);

  it('normalizes every volatile presentation value class', () => {
    expect(normalizeVolatile([
      '2026-09-18T12:34:56.000Z',
      'req_0123456789abcdef',
      '123e4567-e89b-42d3-a456-426614174000',
      TEST_SHA,
      '99.000%',
      '100 measured intervals',
      'row id 731',
    ].join(' | '))).toBe([
      '<TIMESTAMP>',
      '<REQUEST_ID>',
      '<UUID>',
      '<COMMIT_SHA>',
      '<AVAILABILITY_PERCENT>',
      '<AVAILABILITY_INTERVALS> measured intervals',
      'row id <ROW_ID>',
    ].join(' | '));
  });

  for (const locale of COMPACT_TEXT_LOCALES) {
    it(`keeps the ${COMPACT_TEXT_CONTRACT[locale].name} text and fallback contract compact and deterministic`, async () => {
      expect(existsSync(new URL(`./fixtures/presentation-baseline/${locale}-text.json`, import.meta.url))).toBe(false);

      const contract = COMPACT_TEXT_CONTRACT[locale];
      const localeSurfaces = surfaces();
      expect(localeSurfaces.map((surface) => surface.id), `${locale} public presentation inventory`).toEqual(EXPECTED_ENGLISH_SURFACE_IDS);
      expect(Object.keys(contract.markers), `${locale} compact text marker inventory`).toEqual(EXPECTED_ENGLISH_SURFACE_IDS);

      for (const surface of localeSurfaces) {
        const { response, window, document } = await renderSurface(surface, locale);
        try {
          const bodyText = normalizeWhitespace(document.body.textContent);
          const marker = contract.markers[surface.id as keyof typeof contract.markers];
          expect(marker, `${surface.id} ${locale} marker`).toBeTruthy();
          expect(bodyText, `${surface.id} ${locale} translated marker`).toContain(marker);

          const documentContract = ENGLISH_DOCUMENT_CONTRACT[surface.id as keyof typeof ENGLISH_DOCUMENT_CONTRACT];
          if (documentContract) {
            const [routeId] = documentContract;
            expect(response.headers.get('content-language'), `${surface.id} ${locale}`).toBe(
              surface.id === 'page:ordinary-404' ? null : locale,
            );
            expect(document.documentElement.getAttribute('lang'), surface.id).toBe(locale);
            expect(document.documentElement.getAttribute('dir'), surface.id).toBe('ltr');
            expect(document.querySelector(`nav[aria-label="${contract.shell.navigation}"]`), surface.id).not.toBeNull();
            expect(document.querySelector('a.skip-link[href="#main"]')?.textContent, surface.id).toContain(contract.shell.skip);
            expect(document.querySelector(`select[name="lang"][aria-label="${contract.shell.language}"] option[value="${locale}"][selected]`), surface.id).not.toBeNull();
            expect(document.querySelector(`button[data-theme-toggle][aria-label="${contract.shell.theme}"]`), surface.id).not.toBeNull();

            const linkNames = [...document.querySelectorAll('a[href]')].map((link) => accessibleName(link, document));
            expect(linkNames, `${surface.id} ${locale} demos nav`).toContain(contract.shell.demos);
            expect(linkNames, `${surface.id} ${locale} source nav`).toContain(contract.shell.source);
            if (routeId) expect(document.body.getAttribute('data-route-id'), surface.id).toBe(routeId);
          } else {
            const demoId = surface.id.slice('demo:'.length);
            expect(response.headers.get('content-language'), surface.id).toBeNull();
            expect(document.querySelector(`[data-demo-section="${demoId}"]`), surface.id).not.toBeNull();
            if (surface.id === 'demo:i18n') {
              expect(document.querySelector(`input[type="hidden"][name="lang"][value="${locale}"]`), surface.id).not.toBeNull();
            }
          }

          const fallbackMarkers = (COMPACT_TEXT_FALLBACK_MARKERS as Readonly<Record<string, readonly string[]>>)[surface.id] ?? [];
          const textEvidence = textInventory(document);
          const presentationText = normalizeWhitespace([
            bodyText,
            ...textEvidence.headings.map((heading) => heading.text),
            ...textEvidence.accessibleNames.map((entry) => entry.name),
            ...textEvidence.labels.map((entry) => entry.label ?? ''),
          ].join(' '));
          for (const fallback of fallbackMarkers) {
            expect(presentationText, `${surface.id} ${locale} intentional fallback: ${fallback}`).toContain(fallback);
          }
        } finally {
          await window.happyDOM.close();
        }
      }
    }, 60_000);
  }

});

describe('DEMO-338 inline-code boundary', () => {
  it('hashes the exact pre-paint theme script and places it in the head before the body', async () => {
    expect(createHash('sha256').update(THEME_BOOT_SCRIPT).digest('base64')).toBe(THEME_BOOT_SHA256);
    const { response, window, document } = await renderSurface({ id: 'home', path: '/', expectedStatus: 200 }, 'en');
    try {
      const policy = response.headers.get('content-security-policy') ?? '';
      expect(policy).toContain(`script-src 'self' 'sha256-${THEME_BOOT_SHA256}'`);
      expect(policy).toContain("style-src 'self'");
      expect(policy).not.toContain("'unsafe-inline'");
      const script = document.head.querySelector('script:not([src])');
      expect(script?.textContent).toBe(THEME_BOOT_SCRIPT);
      expect(script?.hasAttribute('async')).toBe(false);
      expect(script?.hasAttribute('defer')).toBe(false);
      expect(script?.getAttribute('type')).toBeNull();
      const headElements = [...document.head.children];
      expect(headElements.indexOf(script!)).toBeLessThan(headElements.indexOf(document.head.querySelector('link[rel="stylesheet"]')!));
    } finally {
      await window.happyDOM.close();
    }
  });

  it('serves no inline handlers, styles, or unhashed scripts in any audited HTML response', async () => {
    const requests: { label: string; response: Response }[] = [];
    for (const locale of PRESENTATION_SECURITY_LOCALES) {
      for (const surface of surfaces()) {
        const path = localizedPath(surface.path, locale);
        const headers = new Headers({ accept: 'text/html' });
        if (surface.authorization) headers.set('authorization', surface.authorization);
        requests.push({ label: `${surface.id} ${locale}`, response: await routeRequest(new Request(new URL(path, ORIGIN), { headers }), environment(), { adminAuthorized: Boolean(surface.authorization) }) });
      }
    }
    for (const mode of ['accessible', 'broken']) {
      requests.push({ label: `accessibility frame ${mode}`, response: accessibilityLabResponse(new Request(`${ORIGIN}/api/labs/accessibility?mode=${mode}`)) });
    }
    requests.push({ label: 'GraphiQL', response: localGraphiqlResponse(new Request(`${ORIGIN}/graphql/ui`)) });
    requests.push({ label: 'safe error', response: safeError(new Request(`${ORIGIN}/failure`, { headers: { accept: 'text/html' } }), new Error('test failure')) });

    for (const { label, response } of requests) {
      expect(response.headers.get('content-type'), label).toContain('text/html');
      const html = await response.text();
      const { window, document } = parseDocument(html, `${ORIGIN}/`);
      try {
        const policy = response.headers.get('content-security-policy') ?? '';
        expect(policy, `${label} policy`).not.toBe('');
        for (const element of document.querySelectorAll('*')) {
          expect(element.hasAttribute('style'), `${label}: inline style on ${element.tagName}`).toBe(false);
          for (const attribute of element.getAttributeNames()) {
            expect(attribute, `${label}: event handler on ${element.tagName}`).not.toMatch(/^on[a-z]+$/i);
          }
        }
        for (const script of document.querySelectorAll('script:not([src])')) {
          const hash = createHash('sha256').update(script.textContent ?? '').digest('base64');
          expect(policy, `${label}: unlisted inline script`).toContain(`'sha256-${hash}'`);
        }
        if (label !== 'GraphiQL') expect(policy, `${label}: unsafe inline policy`).not.toContain("'unsafe-inline'");
      } finally {
        await window.happyDOM.close();
      }
    }
  }, 60_000);
});
