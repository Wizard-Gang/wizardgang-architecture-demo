import { describe, expect, it } from 'vitest';
import {
  defaultLocale,
  supportedLocales,
} from '../src/i18n/runtime';
import { routeRequest } from '../src/router';
import type { Env } from '../src/types';
import { demoDatabase } from './helpers/wg-storage';

function environment(): Env {
  return {
    WG_DB: demoDatabase({ crawler: 'enabled' }),
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
  };
}

describe('DEMO-292 localization script placeholder restoration', () => {
  it('returns the D1 presentation fragment without localization placeholder tokens in any locale', async () => {
    for (const locale of supportedLocales) {
      const url = new URL('https://demo.wizardgang.ai/api/demos/d1');
      if (locale !== defaultLocale) url.searchParams.set('lang', locale);

      const response = await routeRequest(new Request(url), environment());
      expect(response.status, locale).toBe(200);
      const body = await response.text();

      expect(body, locale).not.toContain('@@WG_I18N_BLOCK_');
    }
  });
});
