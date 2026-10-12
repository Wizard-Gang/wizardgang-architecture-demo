import type { Env } from './types';
import { renderNotFound } from './ui/not-found';
import type { AdminIdentity } from './lib/admin-auth';
import { requireAdmin, requireSameOrigin } from './lib/admin-auth';
import { identityReadiness, readIdentitySession } from './lib/identity-session';
import { json, methodNotAllowed, safeError } from './lib/http';
import {
  bindLocalization,
  localeNormalizationRedirect,
  localePreferenceCookie,
  resolveLocalization,
  shouldPersistLocale,
  type LocalizationContext,
} from './i18n/runtime';
import {
  applicationRouteRegistry,
  type ApplicationRouteContext,
  type ApplicationRouteDeclaration,
} from './routing/application-routes';
import { matchRoute, normalizeRoutePath, type CachePolicy, type RouteMethod } from './routing/registry';

function cacheControl(policy: Exclude<CachePolicy, { mode: 'response' }>): string {
  if (policy.mode === 'no-store') return 'no-store';
  if (policy.mode === 'private') {
    return policy.maxAgeSeconds === undefined ? 'private' : `private, max-age=${policy.maxAgeSeconds}`;
  }
  return [
    'public',
    `max-age=${policy.maxAgeSeconds}`,
    ...(policy.staleWhileRevalidateSeconds === undefined
      ? []
      : [`stale-while-revalidate=${policy.staleWhileRevalidateSeconds}`]),
    ...(policy.immutable ? ['immutable'] : []),
  ].join(', ');
}

function applyResponsePolicy(response: Response, route: ApplicationRouteDeclaration): Response {
  const headers = new Headers(response.headers);
  if (route.cache.mode === 'response') {
    if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  } else {
    headers.set('cache-control', cacheControl(route.cache));
  }
  if (route.crawler.indexing === 'deny') headers.set('x-robots-tag', 'noindex, nofollow');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withLocalizationHeaders(
  response: Response,
  localization: LocalizationContext,
  persistPreference: boolean,
): Response {
  const headers = new Headers(response.headers);
  headers.set('content-language', localization.lang);
  if (persistPreference) headers.set('set-cookie', localePreferenceCookie(localization));
  if (persistPreference || localization.locale !== localization.defaultLocale) {
    headers.set('cache-control', 'private, no-store');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

type OpenAIAgent = 'OAI-SearchBot' | 'ChatGPT-User' | 'GPTBot';

function identifyOpenAIAgent(userAgent: string | null): OpenAIAgent | null {
  if (!userAgent) return null;
  if (/OAI-SearchBot/i.test(userAgent)) return 'OAI-SearchBot';
  if (/ChatGPT-User/i.test(userAgent)) return 'ChatGPT-User';
  if (/GPTBot/i.test(userAgent)) return 'GPTBot';
  return null;
}

// Matches the shell's static robots.txt: GPTBot (model training) is refused everywhere, and OpenAI search and
// user-triggered fetches are refused only on routes that deny crawling.
function crawlerPolicyFailure(request: Request, route: ApplicationRouteDeclaration): Response | null {
  const agent = identifyOpenAIAgent(request.headers.get('user-agent'));
  if (!agent || (agent !== 'GPTBot' && route.crawler.crawling === 'allow')) return null;
  return json({
    status: 'blocked',
    agent,
    reason: agent === 'GPTBot' ? 'model_training_disabled' : 'route_crawling_denied',
  }, {
    status: 403,
    headers: {
      'cache-control': 'no-store',
      vary: 'User-Agent',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function acceptsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html') || accept === '';
}

async function authenticateRoute(
  request: Request,
  env: Env,
  route: ApplicationRouteDeclaration,
  adminAuthorized: boolean,
): Promise<AdminIdentity | Response | undefined> {
  if (route.authentication.mode === 'anonymous') return undefined;
  if (route.authentication.provider === 'wg-ops') return requireAdmin(adminAuthorized);
  if (route.authentication.provider === 'identity-session') {
    if (await identityReadiness(env) !== 'ready') {
      return json({ error: 'identity_not_configured' }, {
        status: 503,
        headers: { 'cache-control': 'no-store', 'retry-after': '30' },
      });
    }
    if (await readIdentitySession(request, env)) return undefined;
    return json({ error: 'authentication_required' }, {
      status: 401,
      headers: { 'cache-control': 'no-store' },
    });
  }
  throw new Error(`Unsupported route authentication provider '${route.authentication.provider}' for ${route.id}`);
}

export async function routeRequest(
  request: Request,
  env: Env,
  options: Readonly<{ adminAuthorized?: boolean }> = {},
): Promise<Response> {
  try {
    return await routeRequestUnsafe(request, env, options);
  } catch (error) {
    return safeError(request, error);
  }
}

async function routeRequestUnsafe(
  request: Request,
  env: Env,
  options: Readonly<{ adminAuthorized?: boolean }>,
): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizeRoutePath(url.pathname);
  const localization = resolveLocalization(request);
  const localizedEnv = bindLocalization(env, localization);

  // The former frontend selected conceptual pages with ?view=. Canonical child
  // routes replaced that contract; every retired selector is an ordinary 404.
  if (url.searchParams.has('view')) return renderNotFound(localizedEnv);

  const match = matchRoute(applicationRouteRegistry, request.method, path);

  if (match.status === 'not-found') return renderNotFound(localizedEnv);
  const route = match.route as ApplicationRouteDeclaration;
  const localizedHtml = route.browserHtml === 'page' && acceptsHtml(request);
  const persistPreference = localizedHtml && shouldPersistLocale(request);

  if (localizedHtml) {
    const normalizedLocaleUrl = localeNormalizationRedirect(request);
    if (normalizedLocaleUrl) {
      const redirect = new Response(null, {
        status: 302,
        headers: { location: normalizedLocaleUrl },
      });
      return withLocalizationHeaders(redirect, localization, persistPreference);
    }
  }

  const crawlerFailure = crawlerPolicyFailure(request, route);
  if (crawlerFailure) return crawlerFailure;

  if (match.status === 'method-not-allowed') return methodNotAllowed([...match.allowedMethods]);

  const authentication = await authenticateRoute(request, env, route, options.adminAuthorized === true);
  if (authentication instanceof Response) return authentication;

  if (route.sameOrigin.mode === 'required' && route.sameOrigin.methods.includes(request.method as RouteMethod)) {
    const originFailure = requireSameOrigin(request);
    if (originFailure) return originFailure;
  }

  const context: ApplicationRouteContext = {
    env: route.browserHtml === 'page' && request.method === 'GET' ? localizedEnv : env,
    ...(authentication ? { adminIdentity: authentication } : {}),
  };
  const response = await route.handler(request, context, match.params);
  const policyResponse = applyResponsePolicy(response, route);
  return localizedHtml
    ? withLocalizationHeaders(policyResponse, localization, persistPreference)
    : policyResponse;
}
