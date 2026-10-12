export const retiredOperationsHtmlPathname = '/operations' as const;

export const removedHtmlPathnames = [
  { pathname: '/platform', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/platform/edge', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/platform/workers', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/platform/durable-objects', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/platform/d1', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/platform/r2', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/interfaces', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/interfaces/rest', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/interfaces/graphql', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/interfaces/webhooks', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/interfaces/identity', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/interfaces/mcp', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/interfaces/accessibility', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/interfaces/i18n', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/edge', outcome: '404', supersededBy: 'demos.index' },
  { pathname: '/workers', outcome: '404', supersededBy: 'demos.index' },
  { pathname: '/durable-objects', outcome: '404', supersededBy: 'demos.index' },
  { pathname: '/d1', outcome: '404', supersededBy: 'demos.index' },
  { pathname: '/r2', outcome: '404', supersededBy: 'demos.index' },
  { pathname: '/api', outcome: '404', supersededBy: 'demos.index' },
  { pathname: '/graphql', outcome: 'protocol' },
  { pathname: '/graphql/console', outcome: '404' },
  { pathname: '/webhooks', outcome: '404', supersededBy: 'demos.index' },
  { pathname: '/identity', outcome: '404', supersededBy: 'demos.index' },
  { pathname: '/mcp', outcome: 'protocol' },
  { pathname: '/mcp/server', outcome: '404', supersededBy: 'demos.index' },
  { pathname: '/i18n', outcome: '404', supersededBy: 'demos.index' },
  { pathname: '/accessibility', outcome: '404', supersededBy: 'demos.index' },
  { pathname: retiredOperationsHtmlPathname, outcome: '404' },
  { pathname: '/operations/availability', outcome: '404', references: 'forbidden' },
  { pathname: '/operations/logs', outcome: '404', references: 'forbidden' },
  { pathname: '/operations/usage', outcome: '404', references: 'forbidden' },
  { pathname: '/operations/reports', outcome: '404', references: 'forbidden' },
  { pathname: '/operations/docs', outcome: '404', references: 'forbidden' },
  { pathname: '/dashboard', outcome: '404' },
  { pathname: '/dashboard/uptime', outcome: '404' },
  { pathname: '/dashboard/docs', outcome: '404' },
  { pathname: '/dashboard/logs', outcome: '404' },
  { pathname: '/dashboard/billing', outcome: '404' },
  { pathname: '/api/rest', outcome: '404', references: 'forbidden' },
  { pathname: '/api/openapi', outcome: '404', references: 'forbidden' },
  { pathname: '/api/graphql', outcome: '404', references: 'forbidden' },
  { pathname: '/api/webhooks', outcome: '404', references: 'forbidden' },
  { pathname: '/identity/oauth', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/identity/sso', outcome: '404', references: 'forbidden', supersededBy: 'demos.index' },
  { pathname: '/dashboard/health', outcome: '404', references: 'forbidden' },
] as const;

export const removedHtml404Pathnames = removedHtmlPathnames
  .filter((entry) => entry.outcome === '404')
  .map((entry) => entry.pathname);

export const retiredDemoBrowserRoots = [
  removedHtmlPathnames[0].pathname,
  removedHtmlPathnames[6].pathname,
] as const;

export const referenceFreeRemovedHtml404Pathnames = removedHtmlPathnames
  .filter((entry) => entry.outcome === '404' && 'references' in entry && entry.references === 'forbidden')
  .map((entry) => entry.pathname);
