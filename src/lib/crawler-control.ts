import type { Env } from '../types';
import { recordDemoEvent } from './audit';
import { json, withSecurityHeaders } from './http';
import { COLLECTIONS, demoRecords } from './storage';

export type CrawlerAccessState = 'enabled' | 'disabled';
export type OpenAIAgent = 'OAI-SearchBot' | 'ChatGPT-User' | 'GPTBot';

export interface CrawlerControl {
  state: CrawlerAccessState;
  updatedAt: string;
  updatedBy: string | null;
}

const DEFAULT_CONTROL: CrawlerControl = {
  state: 'disabled',
  updatedAt: new Date(0).toISOString(),
  updatedBy: null,
};

export async function getCrawlerControl(env: Env): Promise<CrawlerControl> {
  try {
    const control = (await demoRecords(env).get<CrawlerControl>(COLLECTIONS.control, 'crawler'))?.body;
    if (!control || (control.state !== 'enabled' && control.state !== 'disabled')) return DEFAULT_CONTROL;
    return control;
  } catch {
    // Fail closed: a missing record or D1 outage must not expose the site to a crawler.
    return DEFAULT_CONTROL;
  }
}

export async function setCrawlerControl(
  env: Env,
  state: CrawlerAccessState,
  updatedBy: string,
): Promise<CrawlerControl> {
  const updatedAt = new Date().toISOString();
  const control: CrawlerControl = { state, updatedAt, updatedBy };
  await demoRecords(env).put(COLLECTIONS.control, 'crawler', control);

  await recordDemoEvent(env, 'admin', 'chatgpt_crawl_access_changed', {
    state,
    actor: 'authenticated-admin',
    updatedAt,
  });


  return control;
}

export function identifyOpenAIAgent(userAgent: string | null): OpenAIAgent | null {
  if (!userAgent) return null;
  if (/OAI-SearchBot/i.test(userAgent)) return 'OAI-SearchBot';
  if (/ChatGPT-User/i.test(userAgent)) return 'ChatGPT-User';
  if (/GPTBot/i.test(userAgent)) return 'GPTBot';
  return null;
}

export function crawlerBlockedResponse(agent: OpenAIAgent): Response {
  const training = agent === 'GPTBot';
  return json({
    status: 'blocked',
    agent,
    reason: training ? 'model_training_disabled' : 'chatgpt_crawl_access_disabled',
  }, {
    status: 403,
    headers: {
      'cache-control': 'no-store',
      vary: 'User-Agent',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

export function robotsResponse(request: Request, control: CrawlerControl): Response {
  const searchDirective = control.state === 'enabled' ? 'Allow: /' : 'Disallow: /';
  const chatGptDirective = control.state === 'enabled' ? 'Allow: /' : 'Disallow: /';
  const body = [
    'User-agent: OAI-SearchBot',
    searchDirective,
    '',
    'User-agent: ChatGPT-User',
    chatGptDirective,
    '',
    'User-agent: GPTBot',
    'Disallow: /',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${new URL('/sitemap.xml', request.url).toString()}`,
    '',
  ].join('\n');
  const headers = withSecurityHeaders(new Headers({
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    vary: 'User-Agent',
    'x-chatgpt-crawl-access': control.state,
  }));
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
}
