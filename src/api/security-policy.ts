import type { Env } from '../types';
import { methodNotAllowed, withSecurityHeaders } from '../lib/http';
import { repoUrl } from '../lib/github';

export const SECURITY_TXT_EXPIRES = '2027-03-02T00:00:00Z';

export function securityTxtResponse(request: Request, env: Env): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed(['GET', 'HEAD']);
  const body = [
    `Contact: ${repoUrl(env)}/security/advisories/new`,
    `Policy: ${repoUrl(env)}/security/policy`,
    'Canonical: https://demo.wizardgang.ai/.well-known/security.txt',
    'Preferred-Languages: en',
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    '',
  ].join('\n');
  const headers = withSecurityHeaders(new Headers({
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  }));
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
