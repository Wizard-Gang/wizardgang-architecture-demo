import {
  createEdge,
  type EdgeEnv,
  type EdgeHandler,
  type Release,
} from '#wg-edge';
import type { Env } from './types';
import { routeRequest } from './router';
import { collectHealth } from './api/operations';
import { sweepDemoStorage } from './lib/storage';
export { DemoCoordinator } from './durable/demo-coordinator';

export type DemoWorkerEnv = Env & EdgeEnv & { WG_APP: 'demo' };

export const DEMO_ROBOTS = [
  'User-agent: OAI-SearchBot',
  'Allow: /',
  '',
  'User-agent: ChatGPT-User',
  'Allow: /',
  '',
  'User-agent: GPTBot',
  'Disallow: /',
  '',
  'User-agent: *',
  'Allow: /',
  '',
  'Sitemap: https://demo.wizardgang.ai/sitemap.xml',
  '',
].join('\n');

export async function runScheduledOperations(env: Env, scheduledTime = Date.now()): Promise<void> {
  await collectHealth(env, true, scheduledTime);
  // Expired demo records and events (sessions, sandboxes, raw health observations) leave the shared tables here.
  await sweepDemoStorage(env, scheduledTime);
}

function releaseEnv(env: DemoWorkerEnv, release: Readonly<Release>): Env {
  return {
    ...env,
    DEPLOYED_VERSION: release.version,
    DEPLOYED_SHA: release.commit,
    DEPLOYMENT_CI_STATUS: release.version === '0.0.0-dev' ? 'not-verified' : 'verified',
    CLOUDFLARE_WORKER_NAME: 'demo',
  };
}

export function createDemoWorker(release: Release): EdgeHandler<DemoWorkerEnv> {
  return createEdge<DemoWorkerEnv>({
    release,
    robots: DEMO_ROBOTS,
    async fetch(request, env, _context, edge) {
      return demoApplicationFetch(request, env, edge);
    },
    async scheduled(controller, env) {
      await runScheduledOperations(env, controller.scheduledTime ?? Date.now());
    },
  });
}

export function demoApplicationFetch(
  request: Request, env: DemoWorkerEnv, edge: Readonly<{ release: Readonly<Release>; admin: boolean }>,
): Promise<Response> {
  return routeRequest(request, releaseEnv(env, edge.release), { adminAuthorized: edge.admin });
}
