import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  CdpClient,
  chromeExecutable,
  evaluate,
  navigate,
  sleep,
  terminateProcess,
  waitForPageTarget,
  waitForUrl,
} from './lib/browser-audit.ts';
import { parseJsonc } from '../platform/conformance/jsonc.mjs';
import { waitForBrowserState, requireCategoryFocus, settledGeometry } from './lib/browser-readiness.ts';
import { runCleanLocalMigrations } from './validate-migrations.ts';

type Route = { id: string; route: string; kind: string; visibility: string; methods: string[] };
type AuditState = { name: string; path: string };
type Finding = { classification: string; category: string; label: string; detail: unknown };

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const manifest: Route[] = JSON.parse(fs.readFileSync('src/generated/route-manifest.json', 'utf8'));
const auditConfig: { states: AuditState[] } = JSON.parse(fs.readFileSync('config/site-audit-states.json', 'utf8'));
const serverPort = Number(process.env.SITE_AUDIT_PORT || 8787);
const debugPort = Number(process.env.SITE_AUDIT_DEBUG_PORT || 9222);
const origin = `http://127.0.0.1:${serverPort}`;
const localSessionSecret = 'demo-335-local-browser-audit-session-key';
// A caller may share one migrated directory (CI, Release). Otherwise, such as a standalone local run,
// the audit owns a fresh directory and applies the pinned schema itself.
const ownedPersistenceDirectory = process.env.WG_LOCAL_D1_PERSIST_TO ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'wg-site-audit-d1-'));
const localPersistenceArgs = ['--persist-to', process.env.WG_LOCAL_D1_PERSIST_TO || ownedPersistenceDirectory];
const axeTags = ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const targetSelector = 'button,select,input:not([type="hidden"]),textarea,summary,[role="button"],[role="tab"]';
const demosPath = manifest.find((route) => route.id === 'demos.index')?.route;
if (!demosPath) throw new Error('Site browser audit could not resolve the demos route.');
const workbenchDemos = {
  d1: ['Data', 'D1'], r2: ['Data', 'R2'], rest: ['APIs', 'REST / OpenAPI'], graphql: ['APIs', 'GraphQL'],
  webhooks: ['Integrations', 'Webhooks'], oauth: ['Identity', 'OAuth 2.0'], sso: ['Identity', 'SSO'], saml: ['Identity', 'SAML'], mcp: ['AI', 'MCP'],
  edge: ['Platform', 'Edge'], workers: ['Platform', 'Workers'], 'durable-objects': ['Platform', 'Durable Objects'],
  accessibility: ['Quality', 'Accessibility'], i18n: ['Quality', 'Internationalization'],
};

function patternMatches(pattern: string, pathname: string) {
  const expected = pattern.split('/').filter(Boolean);
  const actual = pathname.split('/').filter(Boolean);
  if (expected.length !== actual.length) return false;
  return expected.every((segment, index) => segment.startsWith(':') || segment === actual[index]);
}

function publicPages() {
  return manifest.filter((route) => route.kind === 'page'
    && route.visibility === 'public'
    && route.methods.includes('GET'));
}

function routePath(route: Route) {
  if (!route.route.includes(':')) return route.route;
  const fixture = auditConfig.states.find((state) => patternMatches(route.route, new URL(state.path, origin).pathname));
  if (!fixture) throw new Error(`new public surface requires accessibility/i18n coverage: ${route.id}`);
  return fixture.path;
}

function localizedPath(routePathname: string, locale: string) {
  const url = new URL(routePathname, origin);
  // Browser runs share a profile, so make even the default locale explicit.
  // Otherwise the preceding Arabic navigation persists an RTL cookie and makes
  // the next nominally English case depend on execution order.
  url.searchParams.set('lang', locale);
  return `${url.pathname}${url.search}${url.hash}`;
}

async function dispatchTab(cdp: CdpClient, shift: boolean = false) {
  const params = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}

function recordFinding(findings: Finding[], category: string, label: string, detail: unknown, expected: boolean = false) {
  const finding = {
    classification: expected ? 'expected/documented finding' : 'new/unrecorded regression',
    category,
    label,
    detail,
  };
  findings.push(finding);
  console.warn(`DEMO289 finding ${finding.classification}: ${JSON.stringify(finding)}`);
}

function baseGeometryExpression() {
  return `(()=>{
    window.scrollTo({left:0,top:window.scrollY,behavior:'instant'});
    const viewport=window.innerWidth;
    const clientWidth=document.documentElement.clientWidth;
    const scrollWidth=document.documentElement.scrollWidth;
    const bodyScrollWidth=document.body.scrollWidth;
    const overflow=scrollWidth>viewport+1;
    const visible=(el)=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&(r.width||r.height)};
    const clipped=[...document.querySelectorAll('button,select,input:not([type="hidden"]),textarea,summary,[role="button"],[role="tab"]')].filter((el)=>{
      if(el.closest('.demo-category-tabs'))return false;
      if(!visible(el))return false; const r=el.getBoundingClientRect();
      return r.left < -1 || r.right > viewport + 1;
    }).map((el)=>el.id||el.getAttribute('role')||el.tagName).slice(0,12);
    const containedByHorizontalScroller=(el)=>{for(let parent=el.parentElement;parent&&parent!==document.body;parent=parent.parentElement){const overflowX=getComputedStyle(parent).overflowX;if(['auto','scroll','hidden','clip'].includes(overflowX))return true}return false};
    const protruding=[...document.querySelectorAll('body *')].filter((el)=>{
      if(!visible(el)||containedByHorizontalScroller(el))return false; const r=el.getBoundingClientRect();
      return r.left < -1 || r.right > viewport + 1;
    }).map((el)=>{const r=el.getBoundingClientRect();return {tag:el.tagName,id:el.id||'',className:typeof el.className==='string'?el.className.slice(0,120):'',left:Math.round(r.left*10)/10,right:Math.round(r.right*10)/10,width:Math.round(r.width*10)/10}}).slice(0,20);
    const d1Tabs=[...document.querySelectorAll('.d1-table-tabs button')].map((el)=>{const r=el.getBoundingClientRect();return {id:el.id,text:(el.textContent||'').trim().slice(0,80),minWidth:parseFloat(getComputedStyle(el).minWidth)||0,width:r.width,left:r.left,right:r.right}});
    const scrollbarWidth=viewport-clientWidth;
    const scrollbarAccountingOnly=overflow&&clipped.length===0&&protruding.length===0&&scrollbarWidth>0&&Math.abs((scrollWidth-viewport)-scrollbarWidth)<=1&&bodyScrollWidth===scrollWidth;
    return {overflow,scrollbarAccountingOnly,clipped,width:viewport,clientWidth,scrollWidth,bodyScrollWidth,scrollX:window.scrollX,protruding,d1Tabs};
  })()`;
}

function isDocumentedD1Reflow(pathname: string, zoom: number, value: number) {
  const sharedBoundary = pathname === demosPath
    && zoom === 400
    && value?.width === 320
    && value?.d1Tabs?.length === 2
    && value.d1Tabs.every((tab) => Math.abs(tab.minWidth - 145) < 0.5);
  if (!sharedBoundary) return false;
  const linuxDocumentOverflow = value.overflow === true
    && Math.abs((value.scrollWidth ?? 0) - 334) <= 1
    && value.clipped.every((id) => value.d1Tabs.some((tab) => tab.id === id));
  const macControlClipping = value.overflow === false
    && value.scrollWidth === value.width
    && value.clipped.length > 0
    && value.clipped.every((id) => value.d1Tabs.some((tab) => tab.id === id));
  return linuxDocumentOverflow || macControlClipping;
}

async function inspectGeometry(cdp: CdpClient, label: string, findings: Finding[], context: Record<string, unknown> = {}) {
  const value = await evaluate(cdp, baseGeometryExpression());
  if ((value.overflow && !value.scrollbarAccountingOnly) || value.clipped.length) {
    const expected = isDocumentedD1Reflow(context.pathname, context.zoom, value);
    recordFinding(findings, 'reflow/clipping', label, value, expected);
  }
  return value;
}

async function runTextSpacing(cdp: CdpClient, label: string, findings: Finding[]) {
  await cdp.call('DOM.enable');
  await cdp.call('CSS.enable');
  const frameTree = await cdp.call('Page.getFrameTree');
  const frameId = frameTree?.frameTree?.frame?.id;
  if (!frameId) throw new Error(`${label} text spacing: missing top-level frame id`);
  const sheet = await cdp.call('CSS.createStyleSheet', { frameId });
  const styleSheetId = sheet?.styleSheetId;
  if (!styleSheetId) throw new Error(`${label} text spacing: could not create DevTools stylesheet`);
  try {
    await cdp.call('CSS.setStyleSheetText', {
      styleSheetId,
      text: '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await inspectGeometry(cdp, `${label} text spacing`, findings);
  } finally {
    await cdp.call('CSS.setStyleSheetText', { styleSheetId, text: '' });
  }
}

async function runFocusAndTrap(cdp: CdpClient, label: string, findings: Finding[]) {
  await evaluate(cdp, `document.body.focus();document.activeElement?.blur();true`);
  const visited = [];
  let invisible = 0;
  const obscured = [];
  for (let i = 0; i < 32; i += 1) {
    await dispatchTab(cdp);
    const state = await evaluate(cdp, `(()=>{
      const el=document.activeElement;if(!el||el===document.body)return {id:'body',visible:false,obscured:false,offscreen:false};
      let r=el.getBoundingClientRect();
      if(r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight){el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});r=el.getBoundingClientRect()}
      const s=getComputedStyle(el);const visible=(parseFloat(s.outlineWidth||'0')>0&&s.outlineStyle!=='none')||s.boxShadow!=='none'||s.borderColor==='CanvasText';
      const left=Math.max(r.left,0);const right=Math.min(r.right,innerWidth);const top=Math.max(r.top,0);const bottom=Math.min(r.bottom,innerHeight);
      const offscreen=right-left<=1||bottom-top<=1;
      const points=offscreen?[]:[[.5,.5],[.15,.15],[.85,.15],[.15,.85],[.85,.85]].map(([px,py])=>[left+(right-left)*px,top+(bottom-top)*py]);
      const hits=points.map(([x,y])=>document.elementFromPoint(x,y));
      const exposed=hits.some((hit)=>!!hit&&(hit===el||el.contains(hit)));
      const id=el.id||el.getAttribute('href')||el.tagName;
      const order=[...document.querySelectorAll('*')].indexOf(el);
      return {id,order,visible,nestedFrame:el instanceof HTMLIFrameElement,obscured:offscreen||!exposed,offscreen,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},hits:hits.map((hit)=>hit?.id||hit?.getAttribute?.('href')||hit?.tagName||null)};
    })()`);
    visited.push(state);
    if (state.id !== 'body' && !state.visible && !state.nestedFrame) invisible += 1;
    if (state.obscured) obscured.push(state);
  }
  const unique = new Set(visited.filter((state)=>state.id).map((state)=>`${state.order}:${state.id}`));
  if (unique.size < 4) recordFinding(findings, 'keyboard trap', label, { focusTargetsReached: unique.size, visited:visited.map((state)=>state.id) }, false);
  if (invisible) recordFinding(findings, 'focus visibility', label, { stepsWithoutVisibleIndicator: invisible }, false);
  if (obscured.length) recordFinding(findings, 'focus obscuring', label, obscured.slice(0,8), false);
  const before = visited.at(-1);
  await dispatchTab(cdp, true);
  const after = await evaluate(cdp, `(()=>{const el=document.activeElement;return {id:el?.id||el?.getAttribute?.('href')||el?.tagName||'',order:el?[...document.querySelectorAll('*')].indexOf(el):-1}})()`);
  const stayedAtNestedFrameBoundary = before.nestedFrame && after.id === 'IFRAME';
  if (before.order === after.order && unique.size > 1 && !stayedAtNestedFrameBoundary) recordFinding(findings, 'reverse keyboard traversal', label, { before:before.id, after:after.id, order:after.order }, false);
}

async function contentSnapshot(cdp: CdpClient, label: string, locale: string) {
  const snapshot = await evaluate(cdp, `(()=>{
    const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h)=>({level:Number(h.tagName.slice(1)),text:(h.textContent||'').trim().replace(/\\s+/g,' ').slice(0,120)}));
    const links=[...document.querySelectorAll('a[href]')].map((a)=>({name:(a.getAttribute('aria-label')||a.textContent||'').trim().replace(/\\s+/g,' ').slice(0,160),href:a.getAttribute('href')}));
    const vague=links.filter((l)=>/^(here|more|details|source|open|read more)$/i.test(l.name));
    const byName=new Map();for(const link of links){const key=link.name.toLowerCase();if(!key)continue;const set=byName.get(key)||new Set();set.add(link.href);byName.set(key,set)}
    const ambiguous=[...byName.entries()].filter(([,set])=>set.size>1).map(([name,set])=>({name,hrefs:[...set]})).slice(0,12);
    const explicitLang=[...document.querySelectorAll('[lang]')].filter((el)=>el!==document.documentElement).length;
    const text=(document.querySelector('main')?.innerText||'').replace(/\\s+/g,' ').trim();
    const words=text.match(/[A-Za-z][A-Za-z'-]*/g)||[];const sentences=text.split(/[.!?]+/).filter((x)=>x.trim()).length||1;
    const abbreviations=[...new Set((text.match(/\\b[A-Z][A-Z0-9-]{1,9}\\b/g)||[]))].slice(0,30);
    return {headings,linkCount:links.length,vague,ambiguous,explicitLang,abbreviations,englishWords:words.length,avgSentenceWords:Number((words.length/sentences).toFixed(1))};
  })()`);
  console.log(`DEMO289 content-review ${label} ${locale}: ${JSON.stringify(snapshot)}`);
  if (snapshot.ambiguous.length) {
    throw new Error(`DEMO-289 content review found repeated link accessible names with different destinations: page=${label} locale=${locale} ambiguous=${JSON.stringify(snapshot.ambiguous)}.`);
  }
  return snapshot;
}

async function runDemo289MediaChecks(cdp: CdpClient, pathname: string, findings: Finding[]) {
  await cdp.call('Emulation.setEmulatedMedia',{media:'screen',features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const reduced=await evaluate(cdp,`({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,active:document.getAnimations().filter((a)=>a.playState==='running').length})`);
  if(!reduced.matches||reduced.active)recordFinding(findings,'reduced motion',pathname,reduced,false);

  await cdp.call('Emulation.setEmulatedMedia',{media:'screen',features:[{name:'forced-colors',value:'active'}]});
  const forced=await evaluate(cdp,`(()=>{const focusable=document.querySelector('a[href],button,select,input,summary,[tabindex]:not([tabindex="-1"])');focusable?.focus();const s=focusable?getComputedStyle(focusable):null;return {matches:matchMedia('(forced-colors: active)').matches,focusable:!!focusable,outline:s?.outlineStyle,border:s?.borderStyle}})()`);
  if(!forced.matches||!forced.focusable)recordFinding(findings,'forced colors',pathname,forced,false);
  await cdp.call('Emulation.setEmulatedMedia',{media:'screen',features:[]});
}

async function runMergedDemo289Checks(cdp: CdpClient, pathname: string, locale: string, coverage: Set<string>, mediaCoverage: Set<string>, findings: Finding[]) {
  const key = localizedPath(pathname, locale);
  if (coverage.has(key)) return;
  coverage.add(key);

  await contentSnapshot(cdp, pathname, locale);
  await runFocusAndTrap(cdp, `${pathname} ${locale}`, findings);
  await runTextSpacing(cdp, `${pathname} ${locale}`, findings);
  for (const [zoom, width] of [[200, 640], [400, 320]]) {
    await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await inspectGeometry(cdp,`${pathname} ${locale} ${zoom}% zoom-equivalent`,findings,{pathname,locale,zoom});
  }

  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  const mediaKey = localizedPath(pathname, 'en');
  if (locale === 'en' && !mediaCoverage.has(mediaKey)) {
    mediaCoverage.add(mediaKey);
    try {
      await runDemo289MediaChecks(cdp, pathname, findings);
    } finally {
      await cdp.call('Emulation.setEmulatedMedia',{media:'screen',features:[]});
    }
  }
}

function inspectionExpression(expectedLocale: string, checkTargetSize: boolean = false) {
  const targetSizeExpression = checkTargetSize
    ? `[...document.querySelectorAll(${JSON.stringify(targetSelector)})].flatMap((el)=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();if(s.display==='none'||s.visibility==='hidden'||r.width===0||r.height===0)return [];return [{name:el.id||el.getAttribute('role')||el.tagName,width:r.width,height:r.height}]})`
    : '[]';
  return `(async()=>{
    ${axeSource}
    const axeResult = await axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(axeTags)} }, resultTypes: ['violations'] });
    const contrastViolations = axeResult.violations.filter((violation)=>violation.id==='color-contrast');
    const targets = ${targetSizeExpression};
    const below24 = targets.filter((target)=>target.width<24||target.height<24);
    const below44 = targets.filter((target)=>target.width<44||target.height<44);
    const ids = [...document.querySelectorAll('[id]')].map((node)=>node.id);
    const duplicateIds = [...new Set(ids.filter((id,index)=>ids.indexOf(id)!==index))];
    const skip = document.querySelector('.skip-link[href^="#"]');
    const skipTarget = skip ? document.querySelector(skip.getAttribute('href')) : null;
    const imagesWithoutAlt = [...document.querySelectorAll('img:not([alt])')].length;
    const tablesWithoutHeaders = [...document.querySelectorAll('table')].filter((table)=>!table.querySelector('th')).length;
    // Linux Chromium subtracts the classic vertical scrollbar from clientWidth
    // while scrollWidth remains the full emulated viewport. That difference is
    // not horizontal page overflow.
    const viewportWidth = window.innerWidth;
    const ordinaryHorizontalOverflow = document.documentElement.scrollWidth > viewportWidth + 1;
    const overflowingElements = [...document.querySelectorAll('body *')]
      .filter((node)=>{ const rect=node.getBoundingClientRect(); return rect.left < -1 || rect.right > viewportWidth + 1; })
      .slice(0, 8)
      .map((node)=>{
        const rect=node.getBoundingClientRect();
        const identity=node.id ? '#' + node.id : node.classList.length ? node.tagName.toLowerCase() + '.' + [...node.classList].join('.') : node.tagName.toLowerCase();
        return identity + '[' + Math.round(rect.left) + '..' + Math.round(rect.right) + ']:' + (node.textContent||'').trim().slice(0,40);
      });
    const clippedControls = [...document.querySelectorAll('button,select,input:not([type="hidden"]),textarea,[role="button"],[role="tab"]')]
      .filter((node)=>{
        if (node.closest('.demo-category-tabs')) return false;
        const style=getComputedStyle(node); if(style.display==='none'||style.visibility==='hidden') return false;
        for (let ancestor=node.parentElement; ancestor; ancestor=ancestor.parentElement) {
          if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
            const summary=ancestor.querySelector(':scope > summary');
            if (!summary || !summary.contains(node)) return false;
          }
        }
        const rect=node.getBoundingClientRect(); if(rect.width===0&&rect.height===0) return false;
        return rect.left < -1 || rect.right > viewportWidth + 1;
      })
      .map((node)=>{
        const rect=node.getBoundingClientRect();
        const identity=node.id ? '#' + node.id : node.classList.length ? node.tagName.toLowerCase() + '.' + [...node.classList].join('.') : node.tagName.toLowerCase();
        return identity + '[' + Math.round(rect.left) + '..' + Math.round(rect.right) + ']';
      });
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      mains: document.querySelectorAll('main').length,
      skipResolves: Boolean(skipTarget),
      duplicateIds,
      imagesWithoutAlt,
      tablesWithoutHeaders,
      ordinaryHorizontalOverflow,
      overflowingElements,
      clippedControls,
      localeSelectorNamed: Boolean(document.querySelector('#global-language[aria-label]')),
      contrastViolations: contrastViolations.map((violation)=>({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        targets: violation.nodes.slice(0, 5).flatMap((node)=>node.target),
      })),
      targetSize: { below24, below44: below44.length, total: targets.length },
      violations: axeResult.violations.filter((violation)=>violation.id!=='color-contrast').map((violation)=>({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        targets: violation.nodes.slice(0, 5).flatMap((node)=>node.target),
      })),
      expectedLocale: ${JSON.stringify(expectedLocale)}
    };
  })()`;
}

async function inspectCurrentPage(cdp: CdpClient, expectedLocale: string, label: string, { checkTargetSize = false }: { checkTargetSize?: boolean } = {}) {
  const report = await evaluate(cdp, inspectionExpression(expectedLocale, checkTargetSize));
  const expectedDir = expectedLocale === 'ar' ? 'rtl' : 'ltr';
  const failures = [];
  if (report.lang !== expectedLocale) failures.push(`lang=${report.lang}`);
  if (report.dir !== expectedDir) failures.push(`dir=${report.dir}`);
  if (report.mains !== 1) failures.push(`main landmarks=${report.mains}`);
  if (!report.skipResolves) failures.push('skip link does not resolve');
  if (report.duplicateIds.length) failures.push(`duplicate ids=${report.duplicateIds.join(',')}`);
  if (report.imagesWithoutAlt) failures.push(`images without alt=${report.imagesWithoutAlt}`);
  if (report.tablesWithoutHeaders) failures.push(`tables without headers=${report.tablesWithoutHeaders}`);
  if (!report.localeSelectorNamed) failures.push('locale selector is not named');
  if (report.ordinaryHorizontalOverflow) failures.push(`page-level horizontal overflow (${report.overflowingElements.join(', ')})`);
  if (report.clippedControls.length) failures.push(`horizontally clipped controls=${report.clippedControls.join(', ')}`);
  if (report.targetSize.below24.length) failures.push(`WCAG 2.5.8 target size under 24px=${JSON.stringify(report.targetSize.below24.slice(0, 12))}`);
  if (report.contrastViolations.length) failures.push(`computed contrast=${report.contrastViolations.map((item)=>`${item.id}(${item.nodes}: ${item.targets.join(', ')})`).join('; ')}`);
  if (report.violations.length) failures.push(`axe=${report.violations.map((item)=>`${item.id}(${item.nodes}: ${item.targets.join(', ')})`).join('; ')}`);
  if (failures.length) throw new Error(`${label}: ${failures.join('; ')}`);
  return report;
}

async function waitForCurrentPageReady(cdp: CdpClient, pathname: string, locale: string, label: string) {
  const url = new URL(pathname, origin);
  if (url.pathname === demosPath) {
    const requestedId = decodeURIComponent(url.hash.slice(1));
    await waitForWorkbenchReady(cdp, workbenchDemos[requestedId] ? requestedId : 'd1', label);
  }
}

async function inspectPath(cdp: CdpClient, pathname: string, locale: string, label: string, options?: { checkTargetSize?: boolean }) {
  await navigate(cdp, `${origin}${localizedPath(pathname, locale)}`);
  await waitForCurrentPageReady(cdp, pathname, locale, label);
  return inspectCurrentPage(cdp, locale, label, options);
}

async function inspectShellGeometry(cdp: CdpClient, label: string) {
  const report = await evaluate(cdp, `(()=>{
    const header=document.querySelector('.site-header');
    const visible=(node)=>{const style=getComputedStyle(node);const rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0};
    const rect=(node)=>{const value=node.getBoundingClientRect();return {left:value.left,right:value.right,top:value.top,bottom:value.bottom,width:value.width,height:value.height}};
    const targets=[...document.querySelectorAll('.site-header a,.site-header button,.site-header select,.site-footer a')].filter(visible);
    const undersized=targets.filter((node)=>{const box=rect(node);return box.width<43.5||box.height<43.5}).map((node)=>node.outerHTML.slice(0,100));
    const outside=targets.filter((node)=>{const box=rect(node);return box.left<-.5||box.right>innerWidth+.5}).map((node)=>node.outerHTML.slice(0,100));
    const labels=[...document.querySelectorAll('.site-header .brand-copy strong,.site-header .nav a,.site-header .header-utilities>a,.site-header [data-theme-toggle],.site-header select')].filter(visible);
    const smallLabels=labels.filter((node)=>parseFloat(getComputedStyle(node).fontSize)<13.9).map((node)=>node.outerHTML.slice(0,100));
    const splitWords=[];
    for(const element of document.querySelectorAll('.site-header a,.site-header button,[role="tab"],button')){
      if(!visible(element))continue;
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
        const node=walker.currentNode;
        for(const match of node.textContent.matchAll(/[^\\s]+/gu)){
          const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);
          if(range.getClientRects().length>1)splitWords.push(element.outerHTML.slice(0,100)+':'+match[0]);
        }
      }
    }
    const pieces=[header.querySelector('.brand'),header.querySelector('.nav'),header.querySelector('.header-utilities')].map(rect);
    return {undersized,outside,smallLabels,splitWords:splitWords.slice(0,10),pieces,header:rect(header),viewport:innerWidth};
  })()`);
  const failures=[];
  if(report.undersized.length)failures.push(`targets under 44x44: ${report.undersized.join(', ')}`);
  if(report.outside.length)failures.push(`targets outside viewport: ${report.outside.join(', ')}`);
  if(report.smallLabels.length)failures.push(`header labels under 14px: ${report.smallLabels.join(', ')}`);
  if(report.splitWords.length)failures.push(`mid-word breaks: ${report.splitWords.join(', ')}`);
  if(Math.max(...report.pieces.map((piece)=>piece.top))-Math.min(...report.pieces.map((piece)=>piece.top))>2)failures.push(`header is not one row: ${JSON.stringify(report.pieces)}`);
  if(report.header.left<-.5||report.header.right>report.viewport+.5)failures.push(`header outside viewport: ${JSON.stringify(report.header)}`);
  if(failures.length)throw new Error(`${label}: ${failures.join('; ')}`);
}

async function dispatchKey(cdp: CdpClient, key: string, code: string = key) {
  const virtualKeyCodes = { Tab: 9, Enter: 13, ' ': 32, Home: 36, End: 35, ArrowLeft: 37, ArrowRight: 39, ArrowDown: 40 };
  const virtualKeyCode = virtualKeyCodes[key] ?? 0;
  const params = { key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode };
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}

async function waitForExpression(cdp: CdpClient, expression: string, label: string, attempts: number = 80) {
  await waitForBrowserState(() => evaluate(cdp, expression, label), Boolean, label, { timeoutMs: attempts * 50 });
}

async function waitForWorkbenchReady(cdp: CdpClient, expectedId: string, label: string, timeoutMs = 10_000) {
  await waitForBrowserState(() => evaluate(cdp, `(()=>{
    const root=document.querySelector('[data-demo-workbench]');
    const selected=document.querySelector('[data-demo-category][aria-selected="true"]');
    return {id:root?.dataset.demoId,mounted:root?.dataset.demoMounted,busy:document.querySelector('[data-demo-panel]')?.getAttribute('aria-busy'),
      selected:selected?.getAttribute('data-demo-category'),focused:document.activeElement?.getAttribute('data-demo-category'),
      panes:document.querySelectorAll('[data-demo-panel] [data-demo-section]').length};
  })()`), (state) => state.id === expectedId && state.mounted === 'true' && state.busy === 'false'
    && state.selected === workbenchDemos[expectedId]?.[0] && state.panes === 1, `${label} workbench mount`, { timeoutMs });
}

async function assertWorkbenchState(cdp: CdpClient, expectedId: string, label: string, expectedHash: string = `#${expectedId}`, expectedLocale: string = 'en', timeoutMs = 10_000) {
  await waitForWorkbenchReady(cdp, expectedId, label, timeoutMs);
  const state = await evaluate(cdp, `(()=>{
    const selectedCategories=[...document.querySelectorAll('[data-demo-category][aria-selected="true"]')];
    const categoryTabStops=[...document.querySelectorAll('[data-demo-category]')].filter((node)=>node.tabIndex===0);
    const visibleSections=[...document.querySelectorAll('[data-demo-panel] [data-demo-section]')].filter((node)=>!node.hidden);
    const inspector=document.querySelector('[data-demo-inspector]');
    const toggle=document.querySelector('[data-demo-inspector-toggle]');
    return {
      hash: location.hash,
      id: document.querySelector('[data-demo-workbench]')?.dataset.demoId,
      category: selectedCategories[0]?.getAttribute('data-demo-category'),
      heading: document.querySelector('[data-demo-active-title]')?.textContent?.trim(),
      mounted: visibleSections.length,
      currentDemoLinks: document.querySelectorAll('[data-demo-link][aria-current="location"]').length,
      selectedCategories: selectedCategories.length,
      categoryTabStops: categoryTabStops.length,
      busy: document.querySelector('[data-demo-panel]')?.getAttribute('aria-busy'),
      inspectorVisible: Boolean(inspector && getComputedStyle(inspector).display !== 'none' && getComputedStyle(inspector).visibility !== 'hidden'),
      inspectorPresent: Boolean(inspector && !inspector.hidden),
      togglePresent: Boolean(toggle && !toggle.hidden),
    };
  })()`);
  const failures = [];
  if (state.hash !== expectedHash) failures.push(`hash=${state.hash}`);
  if (state.id !== expectedId) failures.push(`demo=${state.id}`);
  if (state.category !== workbenchDemos[expectedId]?.[0]) failures.push(`category=${state.category}`);
  if (expectedLocale === 'en' && state.heading !== workbenchDemos[expectedId]?.[1]) failures.push(`heading=${state.heading}`);
  if (expectedLocale !== 'en' && !state.heading) failures.push('heading is empty');
  if (state.mounted !== 1) failures.push(`mounted presentations=${state.mounted}`);
  const expectedCurrentLinks = ['webhooks', 'mcp'].includes(expectedId) ? 0 : 1;
  if (state.currentDemoLinks !== expectedCurrentLinks) failures.push(`current demo links=${state.currentDemoLinks}`);
  if (state.selectedCategories !== 1) failures.push(`selected categories=${state.selectedCategories}`);
  if (state.categoryTabStops !== 1) failures.push(`category tab stops=${state.categoryTabStops}`);
  if (state.busy !== 'false') failures.push(`aria-busy=${state.busy}`);
  const inspectorExpected = ['d1', 'r2', 'workers', 'durable-objects', 'i18n'].includes(expectedId);
  if (state.inspectorPresent !== inspectorExpected) failures.push(`inspector present=${state.inspectorPresent}`);
  if (state.togglePresent !== inspectorExpected) failures.push(`inspector toggle present=${state.togglePresent}`);
  if (state.inspectorVisible !== (inspectorExpected && await evaluate(cdp, 'innerWidth > 900'))) failures.push(`inspector visible=${state.inspectorVisible}`);
  if (failures.length) throw new Error(`${label}: ${failures.join('; ')}`);
}

async function switchWorkbenchLocale(cdp: CdpClient, locale: string, expectedId: string) {
  const loaded = cdp.once('Page.loadEventFired', {
    label: `${expectedId} ${locale} locale switch load`,
    timeoutMs: 30_000,
  });
  await evaluate(cdp, `(()=>{
    const form=document.querySelector('[data-preserve-fragment]');
    const select=document.querySelector('#global-language');
    if (!(form instanceof HTMLFormElement) || !(select instanceof HTMLSelectElement)) return false;
    select.value=${JSON.stringify(locale)};
    form.requestSubmit();
    return true;
  })()`);
  await loaded;
  await assertWorkbenchState(cdp, expectedId, `${expectedId} ${locale} locale switch`, `#${expectedId}`, locale);
  const localeState = await evaluate(cdp, `({lang:document.documentElement.lang,dir:document.documentElement.dir,hash:location.hash})`);
  if (localeState.lang !== locale || localeState.dir !== (locale === 'ar' ? 'rtl' : 'ltr') || localeState.hash !== `#${expectedId}`) {
    throw new Error(`${expectedId}: locale switch lost state (${JSON.stringify(localeState)})`);
  }
}

async function exerciseDemo337Workflows(cdp: CdpClient, locale: string) {
  await navigate(cdp, `${origin}/demos?lang=${locale}#mcp`);
  await assertWorkbenchState(cdp, 'mcp', `MCP ${locale} workflow`, '#mcp', locale);
  await evaluate(cdp, `document.querySelector('[data-demo-panel] [data-mcp-run]')?.click();true`);
  await waitForExpression(cdp, `document.querySelector('[data-demo-panel] [data-mcp-output]')?.textContent?.includes('200')`, `MCP ${locale} ping`, 160);

  await navigate(cdp, `${origin}/demos?lang=${locale}#edge`);
  await assertWorkbenchState(cdp, 'edge', `Edge ${locale} workflow`, '#edge', locale);
  await evaluate(cdp, `document.querySelector('[data-demo-panel] [data-edge-run]')?.click();true`);
  await waitForExpression(cdp, `document.querySelector('[data-demo-panel] [data-edge-raw]')?.textContent?.includes('"request"')`, `Edge ${locale} inspection`);

  await navigate(cdp, `${origin}/demos?lang=${locale}#workers`);
  await assertWorkbenchState(cdp, 'workers', `Workers ${locale} workflow`, '#workers', locale);
  await evaluate(cdp, `document.querySelector('[data-demo-panel] [data-worker-policy]')?.requestSubmit();true`);
  await waitForExpression(cdp, `document.querySelector('[data-demo-panel] [data-worker-result]')?.hidden === false`, `Workers ${locale} policy`);

  await navigate(cdp, `${origin}/demos?lang=${locale}#durable-objects`);
  await assertWorkbenchState(cdp, 'durable-objects', `Durable Objects ${locale} workflow`, '#durable-objects', locale);
  await waitForExpression(cdp, `!document.querySelector('[data-demo-panel] [data-durable-current]')?.textContent?.includes('Loading')`, `Durable Objects ${locale} initial counter`);
  await evaluate(cdp, `document.querySelector('[data-demo-panel] [data-durable-run="1"]')?.click();true`);
  await waitForExpression(cdp, `document.querySelector('[data-demo-panel] [data-durable-raw]')?.textContent?.includes('"counter"')`, `Durable Objects ${locale} increment`, 160);

  await navigate(cdp, `${origin}/demos?lang=${locale}#accessibility`);
  await assertWorkbenchState(cdp, 'accessibility', `Accessibility ${locale} workflow`, '#accessibility', locale);
  await waitForExpression(cdp, `document.querySelector('[data-demo-panel] [data-run-a11y-scan]')?.disabled === false`, `Accessibility ${locale} ready`);
  const beforeScan = await evaluate(cdp, `({state:document.querySelector('[data-demo-panel] [data-scan-state]')?.textContent,duration:document.querySelector('[data-demo-panel] [data-scan-meta]')?.dataset.durationMs})`);
  if (beforeScan.duration) throw new Error(`Accessibility ${locale} scan started without request: ${JSON.stringify(beforeScan)}`);
  await evaluate(cdp, `document.querySelector('[data-demo-panel] [data-run-a11y-scan]').click();true`);
  try {
    await waitForExpression(cdp, `Number(document.querySelector('[data-demo-panel] [data-scan-meta]')?.dataset.durationMs) > 0`, `Accessibility ${locale} axe result`, 240);
  } catch (error) {
    const parent = await evaluate(cdp, `({state:document.querySelector('[data-demo-panel] [data-scan-state]')?.textContent,meta:document.querySelector('[data-demo-panel] [data-scan-meta]')?.textContent,frameSrc:document.querySelector('[data-a11y-frame]')?.getAttribute('src'),frameSrcdoc:document.querySelector('[data-a11y-frame]')?.getAttribute('srcdoc')?.slice(0,80)})`);
    const tree = await cdp.call('Page.getFrameTree');
    const frameId = tree.frameTree.childFrames?.[0]?.frame.id;
    if (!frameId) throw new Error(`${error instanceof Error ? error.message : String(error)}; parent=${JSON.stringify(parent)}; childFrames=0`);
    const world = await cdp.call('Page.createIsolatedWorld', { frameId, worldName: 'accessibility-audit-diagnostics' });
    const detail = await cdp.call('Runtime.evaluate', {
      contextId: world.executionContextId,
      expression: `({base:document.baseURI,ready:document.readyState,axe:typeof axe,scripts:[...document.scripts].map((script)=>({src:script.src,type:script.type})),text:document.body?.innerText?.slice(0,120)})`,
      returnByValue: true,
    });
    throw new Error(`${error instanceof Error ? error.message : String(error)}; parent=${JSON.stringify(parent)}; frame=${JSON.stringify(detail.result?.value)}`);
  }
  const scan = await evaluate(cdp, `({state:document.querySelector('[data-demo-panel] [data-scan-state]')?.textContent?.trim(),duration:document.querySelector('[data-demo-panel] [data-scan-meta]')?.dataset.durationMs})`);
  if (!(Number(scan.duration) > 0)) throw new Error(`Accessibility ${locale} axe evidence missing duration: ${JSON.stringify(scan)}`);

  await navigate(cdp, `${origin}/demos?lang=${locale}&count=3#i18n`);
  await assertWorkbenchState(cdp, 'i18n', `Internationalization ${locale} workflow`, '#i18n', locale);
  await evaluate(cdp, `document.querySelector('[data-demo-panel] [data-inspect-target="card.title"]')?.click();true`);
  await waitForExpression(cdp, `document.querySelector('[data-demo-panel] [data-resource-excerpt]')?.textContent?.includes('"key": "card.title"')`, `Internationalization ${locale} inspector`);
}

async function traverseBrowserHistory(cdp: CdpClient, offset: number, expectedId: string, label: string) {
  const history = await cdp.call('Page.getNavigationHistory');
  const entry = history.entries[history.currentIndex + offset];
  if (!entry) throw new Error(`${label}: browser history has no entry at offset ${offset}`);
  await cdp.call('Page.navigateToHistoryEntry', { entryId: entry.id });
  await assertWorkbenchState(cdp, expectedId, label);
}

async function accessibilityGeometryAudit(cdp: CdpClient) {
  for (const width of [375, 1280]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 812, deviceScaleFactor: 1, mobile: width < 768 });
    await navigate(cdp, `${origin}/demos?lang=en#accessibility`);
    await assertWorkbenchState(cdp, 'accessibility', `Accessibility ${width}px geometry`, '#accessibility', 'en');
    await waitForExpression(cdp, `Number.parseInt(document.querySelector('[data-a11y-frame]')?.style.height || '0',10) >= 200`, `Accessibility ${width}px frame sizing`);
    const layout = await evaluate(cdp, `(()=>{
      const panel=document.querySelector('[data-demo-panel]');
      const steps=panel.querySelector('.accessibility-run-steps');
      const frame=panel.querySelector('[data-a11y-frame]');
      const cards=panel.querySelector('.criterion-cards');
      return {stepsBeforeFrame:Boolean(steps&&frame&&steps.compareDocumentPosition(frame)&Node.DOCUMENT_POSITION_FOLLOWING),
        frameWidth:frame?.getBoundingClientRect().width, frameHeight:frame?.getBoundingClientRect().height,
        cardsVisible:getComputedStyle(cards).display!=='none', cardsCollapsed:[...cards.querySelectorAll('details')].every((card)=>!card.open),
        tableVisible:getComputedStyle(panel.querySelector('.criterion-matrix-wrap')).display!=='none'};
    })()`);
    if (!layout.stepsBeforeFrame || layout.frameWidth < 200 || layout.frameHeight < 400 || (width === 375 && (!layout.cardsVisible || !layout.cardsCollapsed || layout.tableVisible)) || (width === 1280 && (layout.cardsVisible || !layout.tableVisible))) {
      throw new Error(`Accessibility ${width}px layout failed: ${JSON.stringify(layout)}`);
    }
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: Math.round(layout.frameWidth), height: Math.round(layout.frameHeight), deviceScaleFactor: 1, mobile: width < 768 });
    await navigate(cdp, `${origin}/api/labs/accessibility?mode=accessible`);
    const size = await evaluate(cdp, `({scrollHeight:document.documentElement.scrollHeight,viewportHeight:innerHeight,scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth})`);
    if (!size || size.scrollHeight > size.viewportHeight + 2 || size.scrollWidth > size.viewportWidth + 2) throw new Error(`Accessibility ${width}px nested scroll: ${JSON.stringify(size)}`);
  }

  for (const width of [250, 375, 430, 1280]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 566, deviceScaleFactor: 1, mobile: width < 768 });
    await navigate(cdp, `${origin}/api/labs/accessibility?mode=accessible`);
    const focus = await evaluate(cdp, `(()=>{
      const footer=document.querySelector('footer');
      const controls=[...document.querySelectorAll('main input, main button, main a')];
      return controls.map((control)=>{
        control.focus();control.scrollIntoView({block:'nearest'});
        const rect=control.getBoundingClientRect(),foot=footer.getBoundingClientRect();
        return {name:control.textContent?.trim()||control.id,visible:rect.top>=-1&&rect.bottom<=innerHeight+1,obscured:getComputedStyle(footer).position==='fixed'&&rect.bottom>foot.top};
      });
    })()`);
    if (!focus.length || focus.some((item) => !item.visible || item.obscured)) throw new Error(`Accessibility ${width}px focus obscured: ${JSON.stringify(focus)}`);
  }
}

async function exerciseD1Workflow(cdp: CdpClient, locale: string) {
  const label = `D1 ${locale} CRUD/reset`;
  const name = `DEMO 334 ${locale} user`;
  const editedName = `${name} edited`;
  const email = `demo-334-${locale}@example.test`;
  await navigate(cdp, `${origin}/demos?lang=${locale}#d1`);
  await assertWorkbenchState(cdp, 'd1', label, '#d1', locale);
  await waitForExpression(cdp, `document.querySelector('[data-count="users"]')?.textContent !== '—'`, `${label} initial users`);

  await evaluate(cdp, `(()=>{
    document.querySelector('[data-demo-reset]')?.click();
    document.querySelector('[data-demo-reset-confirm]')?.click();
    return true;
  })()`);
  await waitForExpression(cdp, `document.querySelector('[data-count="users"]')?.textContent === '3' && !document.querySelector('[data-demo-reset-dialog]')?.open`, `${label} reset`);

  await evaluate(cdp, `(()=>{
    document.querySelector('[data-demo-panel] [data-add="users"]')?.click();
    const form=document.querySelector('[data-demo-panel] [data-form="users"]');
    form.elements.name.value=${JSON.stringify(name)};
    form.elements.email.value=${JSON.stringify(email)};
    form.elements.role.value='member';
    form.requestSubmit();
    return true;
  })()`);
  await waitForExpression(cdp, `(()=>[...document.querySelectorAll('[data-rows="users"] tr')].some((row)=>row.querySelector('strong')?.textContent===${JSON.stringify(name)}))()`, `${label} create`, 160);

  await evaluate(cdp, `(()=>{
    const row=[...document.querySelectorAll('[data-rows="users"] tr')].find((item)=>item.querySelector('strong')?.textContent===${JSON.stringify(name)});
    row?.querySelector('[data-edit-user]')?.click();
    const form=document.querySelector('[data-demo-panel] [data-form="users"]');
    form.elements.name.value=${JSON.stringify(editedName)};
    form.requestSubmit();
    return true;
  })()`);
  await waitForExpression(cdp, `(()=>[...document.querySelectorAll('[data-rows="users"] tr')].some((row)=>row.querySelector('strong')?.textContent===${JSON.stringify(editedName)}))()`, `${label} edit`, 160);

  await evaluate(cdp, `(()=>{
    const row=[...document.querySelectorAll('[data-rows="users"] tr')].find((item)=>item.querySelector('strong')?.textContent===${JSON.stringify(editedName)});
    row?.querySelector('[data-delete-user]')?.click();
    document.querySelector('[data-demo-panel] [data-confirm-action]')?.click();
    return true;
  })()`);
  await waitForExpression(cdp, `(()=>![...document.querySelectorAll('[data-rows="users"] tr')].some((row)=>row.querySelector('strong')?.textContent===${JSON.stringify(editedName)}))()`, `${label} delete`, 160);

  await evaluate(cdp, `(()=>{
    document.querySelector('[data-demo-reset]')?.click();
    document.querySelector('[data-demo-reset-confirm]')?.click();
    return true;
  })()`);
  await waitForExpression(cdp, `document.querySelector('[data-count="users"]')?.textContent === '3' && !document.querySelector('[data-demo-reset-dialog]')?.open`, `${label} final reset`, 160);
  const result = await evaluate(cdp, `(()=>({
    lang:document.documentElement.lang,
    dir:document.documentElement.dir,
    users:document.querySelector('[data-count="users"]')?.textContent,
    userRatio:[...document.querySelectorAll('[data-count="users"]')].map((node)=>({value:node.parentElement?.textContent?.trim(),tag:node.parentElement?.tagName,dir:node.parentElement?.dir})),
    headingRatio:(()=>{const node=document.querySelector('[data-heading-count="users"]');return {value:node?.textContent?.trim(),tag:node?.tagName,dir:node?.dir}})(),
    sql:document.querySelector('[data-inspector-sql]')?.textContent?.trim(),
    response:document.querySelector('[data-state-output]')?.textContent?.trim(),
    status:document.querySelector('[data-inspector-status]')?.textContent?.trim()
  }))()`);
  if (result.lang !== locale || result.dir !== (locale === 'ar' ? 'rtl' : 'ltr') || result.users !== '3' || !result.sql || !result.response || !result.status) {
    throw new Error(`${label} did not preserve localized CRUD/reset and SQL inspector behavior: ${JSON.stringify(result)}`);
  }
  if (locale === 'ar' && (result.userRatio.some((ratio)=>ratio.tag !== 'BDI' || ratio.dir !== 'ltr' || ratio.value !== '3 / 10') || result.headingRatio.tag !== 'BDI' || result.headingRatio.dir !== 'ltr' || result.headingRatio.value !== '3 / 10')) {
    throw new Error(`${label} reordered a D1 ratio in RTL: ${JSON.stringify(result)}`);
  }
}

async function exerciseR2Workflow(cdp: CdpClient, locale: string) {
  const label = `R2 ${locale} upload/preview/delete`;
  const fileName = `demo-334-${locale}.txt`;
  const fileBody = `DEMO-334 ${locale} R2 preview`;
  await navigate(cdp, `${origin}/demos?lang=${locale}#r2`);
  await assertWorkbenchState(cdp, 'r2', label, '#r2', locale);
  await waitForExpression(cdp, `!document.querySelector('[data-sandbox-usage]')?.textContent?.includes('Loading')`, `${label} initial inventory`, 160);

  await evaluate(cdp, `(()=>{document.querySelector('[data-demo-reset]')?.click();document.querySelector('[data-demo-reset-confirm]')?.click();return true})()`);
  await waitForExpression(cdp, `document.querySelector('[data-sandbox-usage]')?.textContent?.startsWith('0 /') && !document.querySelector('[data-demo-reset-dialog]')?.open`, `${label} clean sandbox`, 160);

  await evaluate(cdp, `(()=>{
    const input=document.querySelector('[data-file-input]');
    const transfer=new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(fileBody)}],${JSON.stringify(fileName)},{type:'text/plain'}));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('[data-upload-form]')?.requestSubmit();
    return true;
  })()`);
  await waitForExpression(cdp, `(()=>[...document.querySelectorAll('.file-row')].some((row)=>row.querySelector('strong')?.textContent===${JSON.stringify(fileName)}))()`, `${label} upload`, 240);

  await evaluate(cdp, `(()=>{
    const row=[...document.querySelectorAll('.file-row')].find((item)=>item.querySelector('strong')?.textContent===${JSON.stringify(fileName)});
    row?.querySelector('[data-preview-id]')?.click();
    return true;
  })()`);
  await waitForExpression(cdp, `document.querySelector('[data-preview-text]')?.textContent === ${JSON.stringify(fileBody)}`, `${label} text preview`, 160);

  await evaluate(cdp, `(()=>{
    const row=[...document.querySelectorAll('.file-row')].find((item)=>item.querySelector('strong')?.textContent===${JSON.stringify(fileName)});
    row?.querySelector('[data-delete-id]')?.click();
    document.querySelector('[data-confirm-delete]')?.click();
    return true;
  })()`);
  await waitForExpression(cdp, `(()=>![...document.querySelectorAll('.file-row')].some((row)=>row.querySelector('strong')?.textContent===${JSON.stringify(fileName)}))()`, `${label} delete`, 240);
  const result = await evaluate(cdp, `(()=>({
    lang:document.documentElement.lang,
    dir:document.documentElement.dir,
    usage:[...document.querySelectorAll('[data-sandbox-usage] bdi')].map((node)=>({value:node.textContent?.trim(),dir:node.dir})),
    method:document.querySelector('[data-request-method]')?.textContent?.trim(),
    status:document.querySelector('[data-request-status]')?.textContent?.trim(),
    response:document.querySelector('[data-r2-output]')?.textContent?.trim(),
    preview:document.querySelector('[data-preview-text]')?.textContent ?? null
  }))()`);
  if (result.lang !== locale || result.dir !== (locale === 'ar' ? 'rtl' : 'ltr') || result.method !== 'DELETE' || !result.status || !result.response || result.preview !== null) {
    throw new Error(`${label} did not preserve localized storage and request inspector behavior: ${JSON.stringify(result)}`);
  }
  if (locale === 'ar' && (result.usage.length !== 2 || result.usage[0].value !== '0 / 10' || result.usage[0].dir !== 'ltr' || result.usage[1].dir !== 'ltr')) {
    throw new Error(`${label} reordered R2 usage in RTL: ${JSON.stringify(result)}`);
  }
}

async function exerciseRestWorkflow(cdp: CdpClient, locale: string) {
  const label = `REST ${locale} six-operation flow`;
  await navigate(cdp, `${origin}/demos?lang=${locale}#rest`);
  await assertWorkbenchState(cdp, 'rest', label, '#rest', locale);

  const initial = await evaluate(cdp, `(()=>{
    const openPanels=[...document.querySelectorAll('[data-rest-operation-panel]')].filter((panel)=>panel.open);
    return {
      released:[...new Set([...document.querySelectorAll('[data-demo-link]')].map((link)=>link.dataset.demoLink))].filter(Boolean).length,
      choices:document.querySelectorAll('[data-rest-operation-select]').length,
      openPanels:openPanels.length,
      fullOpenApi:Boolean(document.querySelector('[data-rest-full-openapi]')),
      oldInventory:document.body.textContent.includes('All demos'),
      oldFullContract:Boolean(document.querySelector('.rest-full-contract')),
    };
  })()`);
  if (initial.released !== Object.keys(workbenchDemos).length || initial.choices !== 6 || initial.openPanels !== 0 || !initial.fullOpenApi || initial.oldInventory || initial.oldFullContract) {
    throw new Error(`${label}: REST evidence containment failed: ${JSON.stringify(initial)}`);
  }

  const run = async (operationId, expectedStatus) => {
    const selected = await evaluate(cdp, `(()=>{
      const panel=document.querySelector('[data-rest-operation-panel=${JSON.stringify(operationId)}]');
      if(panel)panel.open=true;
      const form=panel?.querySelector('[data-rest-form]');
      if (!(form instanceof HTMLFormElement)) return false;
      form.requestSubmit();
      return true;
    })()`);
    if (!selected) throw new Error(`${label}: operation ${operationId} was not available`);
    await waitForExpression(cdp, `(()=>{
      const panel=document.querySelector('[data-rest-operation-panel=${JSON.stringify(operationId)}]');
      const status=panel?.querySelector('[data-rest-status]')?.textContent?.trim()||'';
      return panel?.querySelector('[data-rest-execute]')?.disabled===false && status.startsWith(${JSON.stringify(String(expectedStatus))});
    })()`, `${label} ${operationId}`, 240);
  };

  await run('listRecords', 200);
  const listResult = await evaluate(cdp, `(()=>{
    const panel=document.querySelector('[data-rest-operation-panel="listRecords"]');
    return {
      body:panel?.querySelector('[data-rest-response-body]')?.textContent||'',
      contract:panel?.querySelector('.rest-declared-responses')?.textContent||'',
      curl:panel?.querySelector('[data-rest-curl]')?.textContent||'',
    };
  })()`);
  if (!listResult.body.includes('"results"') || !listResult.contract.includes('200') || !listResult.curl.includes('--cookie-jar')) {
    throw new Error(`${label}: GET response/contract/curl evidence is incomplete: ${JSON.stringify(listResult)}`);
  }

  await run('createRecord', 201);
  await run('getRecord', 200);
  await run('replaceRecord', 200);
  await run('updateRecord', 200);
  const patch = await evaluate(cdp, `(()=>{
    const panel=document.querySelector('[data-rest-operation-panel="updateRecord"]');
    return {
      open:panel?.open,
      status:panel?.querySelector('[data-rest-status]')?.textContent||'',
      contract:panel?.querySelector('.rest-document-block')?.textContent||'',
    };
  })()`);
  if (!patch.open || !patch.contract.includes('id')) {
    throw new Error(`${label}: PATCH behavior was not paired with its relevant contract: ${JSON.stringify(patch)}`);
  }
  await run('deleteRecord', 204);
  const result = await evaluate(cdp, `(()=>({
    lang:document.documentElement.lang,
    dir:document.documentElement.dir,
    selected:document.querySelector('[data-rest-operation-panel="deleteRecord"]')?.open,
    status:document.querySelector('[data-rest-operation-panel="deleteRecord"] [data-rest-status]')?.textContent?.trim(),
    request:document.querySelector('[data-rest-operation-panel="deleteRecord"] [data-rest-request]')?.textContent?.trim(),
    body:document.querySelector('[data-rest-operation-panel="deleteRecord"] [data-rest-response-body]')?.textContent?.trim(),
    curl:document.querySelector('[data-rest-operation-panel="deleteRecord"] [data-rest-curl]')?.textContent?.trim(),
    duration:document.querySelector('[data-rest-operation-panel="deleteRecord"] [data-rest-duration]')?.textContent?.trim()
  }))()`);
  if (result.lang !== locale || result.dir !== (locale === 'ar' ? 'rtl' : 'ltr') || !result.selected || !result.status?.startsWith('204') || !result.request?.includes('DELETE') || !result.body || !result.curl?.includes('--cookie-jar') || !result.duration?.endsWith(' ms')) {
    throw new Error(`${label} did not preserve all operations and localized state: ${JSON.stringify(result)}`);
  }
}

async function restDocumentReflowAudit(cdp: CdpClient) {
  for (const width of [320, 375, 768, 1440]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    for (const locale of ['en', 'ar']) {
      await navigate(cdp, `${origin}/demos?lang=${locale}#rest`);
      await assertWorkbenchState(cdp, 'rest', `REST document ${width}px ${locale}`, '#rest', locale);
      const geometry = await evaluate(cdp, `(()=>{
        document.querySelectorAll('.rest-operation,.rest-schema').forEach((item)=>{item.open=true});
        const scope=document.querySelector('.rest-openapi');
        const server=scope?.querySelector('.rest-server code');
        const paths=[...scope.querySelectorAll('.rest-path')];
        const schemaRows=[...scope.querySelectorAll('.rest-schema-properties>div')];
        const viewport=innerWidth;
        const inside=(element)=>{const r=element.getBoundingClientRect();return r.left>=-1&&r.right<=viewport+1};
        const pathTokens=paths.flatMap((path)=>[...path.querySelectorAll('span')]).map((part)=>({
          text:part.textContent,inside:inside(part),breaks:getComputedStyle(part).overflowWrap
        }));
        return {
          overflow:document.documentElement.scrollWidth>viewport+1,
          server:server?.textContent,
          serverInside:server&&inside(server),
          pathTokens,
          schemaRowsInside:schemaRows.every(inside),
          operationCount:paths.length,
          schemaCount:scope.querySelectorAll('.rest-schema').length
        };
      })()`);
      if (geometry.overflow || !geometry.serverInside || geometry.server !== 'https://demo.wizardgang.ai' || geometry.pathTokens.some((token) => !token.inside || token.breaks === 'anywhere') || !geometry.schemaRowsInside || geometry.operationCount !== 6 || geometry.schemaCount !== 5) {
        throw new Error(`REST document ${width}px ${locale}: clipped URL, path, or schema: ${JSON.stringify(geometry)}`);
      }
    }
  }
}

async function exerciseGraphqlWorkflow(cdp: CdpClient, locale: string) {
  const label = `GraphQL ${locale} query flow`;
  await navigate(cdp, `${origin}/demos?lang=${locale}#graphql`);
  await assertWorkbenchState(cdp, 'graphql', label, '#graphql', locale);
  for (const index of [0, 1]) {
    await evaluate(cdp, `document.querySelector('[data-graphql-example=${JSON.stringify(String(index))}]')?.click();true`);
    await waitForExpression(cdp, `(()=>{
      const output=document.querySelector('[data-graphql-result=${JSON.stringify(String(index))}]');
      const status=document.querySelector('[data-graphql-example-status=${JSON.stringify(String(index))}]')?.textContent||'';
      return output && !output.hidden && output.textContent.includes('"data"') && status.includes('HTTP 200');
    })()`, `${label} example ${index + 1}`, 240);
  }
  await evaluate(cdp, `(()=>{
    const query=document.querySelector('[data-graphql-form] textarea[name="query"]');
    const form=document.querySelector('[data-graphql-form]');
    if (!(query instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return false;
    query.value='query Names { users { name } }';
    form.requestSubmit();
    return true;
  })()`);
  await waitForExpression(cdp, `(()=>{
    const output=document.querySelector('[data-graphql-workspace-result]')?.textContent||'';
    const status=document.querySelector('[data-graphql-runner-status]')?.textContent||'';
    return output.includes('"users"') && status.includes('HTTP 200');
  })()`, `${label} editable runner`, 240);
  const result = await evaluate(cdp, `({
    lang:document.documentElement.lang,
    dir:document.documentElement.dir,
    status:document.querySelector('[data-graphql-runner-status]')?.textContent?.trim(),
    response:document.querySelector('[data-graphql-workspace-result]')?.textContent?.trim()
  })`);
  if (result.lang !== locale || result.dir !== (locale === 'ar' ? 'rtl' : 'ltr') || !result.status?.includes('HTTP 200') || !result.response?.includes('"users"')) {
    throw new Error(`${label} did not preserve query execution and localized state: ${JSON.stringify(result)}`);
  }
}

async function workbenchInteractionAudit(cdp: CdpClient) {
  await navigate(cdp, `${origin}/demos?lang=en`);
  await assertWorkbenchState(cdp, 'd1', 'missing fragment default', '');
  await navigate(cdp, `${origin}/demos?lang=en#not-a-demo`);
  await waitForExpression(cdp, `document.querySelector('[data-demo-workbench]')?.dataset.demoMounted === 'true'`, 'invalid fragment fallback');
  const invalidFallback = await evaluate(cdp, `({id:document.querySelector('[data-demo-workbench]')?.dataset.demoId,heading:document.querySelector('[data-demo-active-title]')?.textContent?.trim(),mounted:document.querySelectorAll('[data-demo-panel] [data-demo-section]').length})`);
  if (invalidFallback.id !== 'd1' || invalidFallback.heading !== 'D1' || invalidFallback.mounted !== 1) throw new Error(`Invalid fragment did not safely fall back to D1: ${JSON.stringify(invalidFallback)}`);

  for (const id of Object.keys(workbenchDemos)) {
    await navigate(cdp, `${origin}/demos?lang=en#${id}`);
    await assertWorkbenchState(cdp, id, `${id} released fragment`);
  }
  await navigate(cdp, `${origin}/demos?lang=en#identity`);
  await assertWorkbenchState(cdp, 'oauth', 'released Identity category fragment', '#identity');

  await navigate(cdp, `${origin}/demos?lang=en#d1`);
  await assertWorkbenchState(cdp, 'd1', 'D1 default');
  await inspectCurrentPage(cdp, 'en', 'D1 workbench');

  const resetState = await evaluate(cdp, `(()=>{
    const reset=document.querySelector('[data-demo-reset]');
    reset?.click();
    const dialog=document.querySelector('[data-demo-reset-dialog]');
    return {visible:reset instanceof HTMLButtonElement&&!reset.hidden,open:dialog instanceof HTMLDialogElement&&dialog.open,title:dialog?.querySelector('h2')?.textContent?.trim()};
  })()`);
  if (!resetState.visible || !resetState.open || resetState.title !== 'Reset this demo?') {
    throw new Error(`Workbench reset confirmation failed: ${JSON.stringify(resetState)}`);
  }
  await evaluate(cdp, `document.querySelector('[data-demo-reset-cancel]')?.click();true`);
  await waitForExpression(cdp, `!document.querySelector('[data-demo-reset-dialog]')?.open && document.activeElement===document.querySelector('[data-demo-reset]')`, 'reset dialog close and focus return');

  for (const mode of ['Guide', 'Request', 'Evidence']) {
    const modeState = await evaluate(cdp, `(()=>{
      const tab=document.querySelector('[data-demo-inspector-mode=${JSON.stringify(mode)}]');
      tab?.click();
      const panel=document.querySelector('[data-demo-inspector-panel]');
      return {selected:tab?.getAttribute('aria-selected'),labelledBy:panel?.getAttribute('aria-labelledby'),text:panel?.textContent?.trim()};
    })()`);
    if (modeState.selected !== 'true' || modeState.labelledBy !== `demo-inspector-tab-${mode.toLowerCase()}` || !modeState.text) {
      throw new Error(`Workbench ${mode} inspector mode failed: ${JSON.stringify(modeState)}`);
    }
  }

  await evaluate(cdp, `document.querySelector('[data-demo-category][aria-selected="true"]')?.focus()`);
  requireCategoryFocus(await evaluate(cdp, `(()=>{const selected=document.querySelector('[data-demo-category][aria-selected="true"]');return {selected:selected?.getAttribute('data-demo-category'),focused:document.activeElement?.getAttribute('data-demo-category'),selectedFocused:!!selected&&document.activeElement===selected}})()`), 'category ArrowRight precondition');
  await dispatchKey(cdp, 'ArrowRight', 'ArrowRight');
  await assertWorkbenchState(cdp, 'rest', 'category ArrowRight');
  const categoryFocus = await evaluate(cdp, `document.activeElement?.getAttribute('data-demo-category')`);
  if (categoryFocus !== 'APIs') throw new Error(`Category navigation lost focus: ${categoryFocus}`);

  await dispatchKey(cdp, 'End', 'End');
  await assertWorkbenchState(cdp, 'accessibility', 'category End');
  await dispatchKey(cdp, 'Home', 'Home');
  await assertWorkbenchState(cdp, 'd1', 'category Home');
  await dispatchKey(cdp, 'ArrowLeft', 'ArrowLeft');
  await assertWorkbenchState(cdp, 'accessibility', 'category ArrowLeft wrap');

  for (const id of ['d1', 'r2', 'rest', 'graphql', 'workers', 'd1']) {
    await evaluate(cdp, `document.querySelector('[data-demo-link=${JSON.stringify(id)}]')?.click()`);
    await assertWorkbenchState(cdp, id, `${id} rapid sequence`);
  }

  await evaluate(cdp, `document.querySelector('[data-demo-link="rest"]')?.click()`);
  await assertWorkbenchState(cdp, 'rest', 'REST history sequence');
  await evaluate(cdp, `document.querySelector('[data-demo-link="graphql"]')?.click()`);
  await assertWorkbenchState(cdp, 'graphql', 'GraphQL secondary selector');
  await evaluate(cdp, `document.querySelector('[data-demo-link="workers"]')?.click()`);
  await assertWorkbenchState(cdp, 'workers', 'Workers selection');
  await evaluate(cdp, `document.querySelector('[data-demo-link="accessibility"]')?.click()`);
  await assertWorkbenchState(cdp, 'accessibility', 'Accessibility selection');

  await traverseBrowserHistory(cdp, -1, 'workers', 'first Back');
  await traverseBrowserHistory(cdp, -1, 'graphql', 'second Back');
  await traverseBrowserHistory(cdp, 1, 'workers', 'Forward');

  await evaluate(cdp, `document.querySelector('[data-demo-inspector-mode="Guide"]')?.focus()`);
  await dispatchKey(cdp, 'End', 'End');
  const inspector = await evaluate(cdp, `(()=>{const tab=document.activeElement;const panel=document.querySelector('[data-demo-inspector-panel]');return {mode:tab?.getAttribute('data-demo-inspector-mode'),selected:tab?.getAttribute('aria-selected'),labelledBy:panel?.getAttribute('aria-labelledby')}})()`);
  if (inspector.mode !== 'Evidence' || inspector.selected !== 'true' || inspector.labelledBy !== 'demo-inspector-tab-evidence') {
    throw new Error(`Inspector keyboard relationship failed: ${JSON.stringify(inspector)}`);
  }

  await navigate(cdp, `${origin}/demos?lang=en#d1`);
  await assertWorkbenchState(cdp, 'd1', 'deterministic loading baseline');
  await evaluate(cdp, `(()=>{const nativeFetch=window.fetch.bind(window);window.__demoNativeFetch=nativeFetch;window.fetch=(input,init)=>String(input).includes('/api/demos/r2')?Promise.reject(new Error('DEMO-271 deterministic load failure')):nativeFetch(input,init);document.querySelector('[data-demo-link="r2"]').click();return true})()`);
  await waitForExpression(cdp, `document.querySelector('[data-demo-panel] [role="alert"]')?.textContent.includes('DEMO-271 deterministic load failure')`, 'contained workbench error');
  const errorState = await evaluate(cdp, `(()=>({demo:document.querySelector('[data-demo-workbench]')?.dataset.demoId,busy:document.querySelector('[data-demo-panel]')?.getAttribute('aria-busy'),retry:document.querySelector('[data-demo-panel] button')?.textContent,nav:document.querySelectorAll('[data-demo-category]').length}))()`);
  if (errorState.demo !== 'r2' || errorState.busy !== 'false' || errorState.retry !== 'Retry demo' || errorState.nav !== 7) throw new Error(`Workbench error containment failed: ${JSON.stringify(errorState)}`);
  const retryFocusable = await evaluate(cdp, `(()=>{window.fetch=window.__demoNativeFetch;const button=document.querySelector('[data-demo-panel] button');button?.focus();return button instanceof HTMLButtonElement&&document.activeElement===button})()`);
  if (!retryFocusable) throw new Error('Workbench retry is not a keyboard-focusable native button.');
  await evaluate(cdp, `document.querySelector('[data-demo-panel] button')?.click();true`);
  await assertWorkbenchState(cdp, 'r2', 'keyboard-accessible retry');

  await navigate(cdp, `${origin}/demos?lang=en#d1`);
  await assertWorkbenchState(cdp, 'd1', 'stale response baseline');
  await evaluate(cdp, `(()=>{const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>String(input).includes('/api/demos/graphql')?new Promise((resolve)=>setTimeout(()=>nativeFetch(input,init).then(resolve),350)):nativeFetch(input,init);document.querySelector('[data-demo-link="graphql"]').click();document.querySelector('[data-demo-link="workers"]').click();return true})()`);
  await assertWorkbenchState(cdp, 'workers', 'late inactive response containment');
  await sleep(500);
  await assertWorkbenchState(cdp, 'workers', 'late inactive response remained contained');

  for (const id of Object.keys(workbenchDemos)) {
    await navigate(cdp, `${origin}/demos?lang=en#${id}`);
    await assertWorkbenchState(cdp, id, `${id} English direct fragment`);
    await switchWorkbenchLocale(cdp, 'ar', id);
    await inspectCurrentPage(cdp, 'ar', `${id} Arabic workbench`);
    await switchWorkbenchLocale(cdp, 'en', id);
  }

  for (const locale of ['en', 'ar']) {
    await exerciseD1Workflow(cdp, locale);
    await exerciseR2Workflow(cdp, locale);
    await exerciseRestWorkflow(cdp, locale);
    await exerciseGraphqlWorkflow(cdp, locale);
    await exerciseDemo337Workflows(cdp, locale);
  }
}

async function sharedResetAudit(cdp: CdpClient, width: number) {
  for (const id of ['d1', 'r2', 'webhooks']) {
    const label = `${id} shared reset ${width}px`;
    await navigate(cdp, `${origin}/demos?lang=en#${id}`);
    await assertWorkbenchState(cdp, id, label);
    const initial = await evaluate(cdp, `(()=>{
      const controls=[...document.querySelectorAll('[data-demo-reset]')];
      const control=controls[0];
      const heading=document.querySelector('.demo-active-heading');
      return {count:controls.length,label:control?.textContent?.trim(),visible:!control?.hidden,
        inHeading:heading?.contains(control),resettable:heading?.textContent?.includes('RESETTABLE'),
        legacy:Boolean(document.querySelector('.d1-sandbox,.sandbox-reset,[data-webhook-reset]'))};
    })()`);
    if (initial.count !== 1 || initial.label !== 'Reset demo' || !initial.visible || !initial.inHeading || !initial.resettable || initial.legacy) {
      throw new Error(`${label} placement failed: ${JSON.stringify(initial)}`);
    }
    const opened = await evaluate(cdp, `(()=>{
      const control=document.querySelector('[data-demo-reset]');control.click();
      const dialog=document.querySelector('[data-demo-reset-dialog]');
      const rect=dialog.getBoundingClientRect();
      return {open:dialog.open,focus:document.activeElement?.hasAttribute('data-demo-reset-cancel'),
        label:dialog.querySelector('h2')?.textContent?.trim(),description:document.querySelector('[data-demo-reset-description]')?.textContent?.trim(),
        fits:rect.left>=0&&rect.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth+1};
    })()`);
    if (!opened.open || !opened.focus || opened.label !== 'Reset this demo?' || !opened.description || !opened.fits) {
      throw new Error(`${label} dialog failed: ${JSON.stringify(opened)}`);
    }
    await evaluate(cdp, `document.querySelector('[data-demo-reset-cancel]').click();true`);
    await waitForExpression(cdp, `!document.querySelector('[data-demo-reset-dialog]').open && document.activeElement===document.querySelector('[data-demo-reset]')`, `${label} cancel focus`);

    if (id === 'r2') {
      await evaluate(cdp, `(()=>{
        const input=document.querySelector('[data-file-input]');const transfer=new DataTransfer();
        transfer.items.add(new File(['reset proof'],'reset-proof.txt',{type:'text/plain'}));
        input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('[data-upload-form]').requestSubmit();return true;
      })()`);
      await waitForExpression(cdp, `[...document.querySelectorAll('.file-row')].some((row)=>row.querySelector('strong')?.textContent==='reset-proof.txt')`, `${label} upload`, 240);
    }
    if (id === 'webhooks') {
      await evaluate(cdp, `document.querySelector('[data-webhook-send]').click();true`);
      await waitForExpression(cdp, `document.querySelector('.webhook-event')!==null`, `${label} synthetic event`, 160);
    }
    const sharedBefore = id === 'r2' ? await evaluate(cdp, `[...document.querySelectorAll('.file-row')].filter((row)=>row.querySelector('[data-owner="demo"]')).map((row)=>row.querySelector('strong')?.textContent)`) : null;
    await evaluate(cdp, `(()=>{document.querySelector('[data-demo-reset]').click();document.querySelector('[data-demo-reset-confirm]').click();return true})()`);
    await waitForExpression(cdp, `!document.querySelector('[data-demo-reset-dialog]').open && document.activeElement===document.querySelector('[data-demo-reset]') && !document.querySelector('[data-demo-reset-notice]').hidden`, `${label} confirm focus`);
    const result = await evaluate(cdp, `({notice:document.querySelector('[data-demo-reset-notice]')?.textContent?.trim(),role:document.querySelector('[data-demo-reset-notice]')?.getAttribute('role')})`);
    if (result.notice !== 'Demo reset complete.' || result.role !== 'status') throw new Error(`${label} result notice failed: ${JSON.stringify(result)}`);
    if (id === 'd1') {
      await waitForExpression(cdp, `document.querySelector('[data-count="users"]')?.textContent==='3' && document.querySelector('[data-count="tasks"]')?.textContent==='4'`, `${label} seed rows`, 160);
    } else if (id === 'r2') {
      await waitForExpression(cdp, `document.querySelector('[data-sandbox-usage]')?.textContent?.startsWith('0 /') && ![...document.querySelectorAll('.file-row')].some((row)=>row.querySelector('strong')?.textContent==='reset-proof.txt')`, `${label} visitor uploads removed`, 160);
      const sharedAfter = await evaluate(cdp, `[...document.querySelectorAll('.file-row')].filter((row)=>row.querySelector('[data-owner="demo"]')).map((row)=>row.querySelector('strong')?.textContent)`);
      if (JSON.stringify(sharedAfter) !== JSON.stringify(sharedBefore)) throw new Error(`${label} shared files changed: ${JSON.stringify({sharedBefore,sharedAfter})}`);
    } else {
      await waitForExpression(cdp, `document.querySelector('.webhook-event')===null && document.querySelector('.webhook-empty')!==null`, `${label} synthetic events cleared`, 160);
    }
  }
}

async function phoneWorkbenchAudit(cdp: CdpClient) {
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  for (const id of Object.keys(workbenchDemos)) {
    await navigate(cdp, `${origin}/demos?lang=en#${id}`);
    await assertWorkbenchState(cdp, id, `${id} phone first viewport`);
    const state = await evaluate(cdp, `(()=>{
      const tabs=document.querySelector('.demo-category-tabs');
      const tabRects=[...tabs.querySelectorAll('[data-demo-category]')].map((tab)=>tab.getBoundingClientRect());
      const control=[...document.querySelectorAll('[data-demo-panel] button,[data-demo-panel] input,[data-demo-panel] select,[data-demo-panel] a')]
        .find((node)=>!node.closest('[hidden]')&&getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().height>0);
      const rect=control?.getBoundingClientRect();
      return {tabsOneRow:tabRects.every((tab)=>Math.abs(tab.top-tabRects[0].top)<2),tabHeight:tabs.getBoundingClientRect().height,
        firstControl:control?.outerHTML.slice(0,100),controlTop:rect?.top,controlBottom:rect?.bottom,viewport:innerHeight,
        overflow:document.documentElement.scrollWidth>innerWidth+1};
    })()`);
    const defaultControlVisible = id !== 'd1' || (state.controlTop >= 0 && state.controlBottom <= state.viewport);
    if (!state.tabsOneRow || state.tabHeight > 60 || !defaultControlVisible || state.overflow) {
      throw new Error(`${id} 375×812 first viewport failed: ${JSON.stringify(state)}`);
    }
  }
  await cdp.call('Emulation.setScriptExecutionDisabled', { value: true });
  try {
    for (const id of ['d1', 'r2', 'workers', 'durable-objects', 'i18n']) {
      await navigate(cdp, `${origin}/demos?demo=${id}`);
      const disclosure = await evaluate(cdp, `(()=>{const d=document.querySelector('[data-demo-inspector-disclosure]');return {summary:d?.querySelector('summary')?.textContent?.trim(),open:d?.open,inline:d&&getComputedStyle(d.closest('[data-demo-inspector]')).position}})()`);
      if (!disclosure.summary || disclosure.open || disclosure.inline !== 'static') throw new Error(`${id} no-JavaScript inline inspector disclosure failed: ${JSON.stringify(disclosure)}`);
    }
    for (const id of ['rest', 'graphql', 'webhooks', 'oauth', 'sso', 'saml', 'mcp', 'edge', 'accessibility']) {
      await navigate(cdp, `${origin}/demos?demo=${id}`);
      const state = await evaluate(cdp, `({id:document.querySelector('[data-demo-workbench]')?.dataset.demoId,
        section:document.querySelector('[data-demo-panel] [data-demo-section]')?.getAttribute('data-demo-section'),
        inspector:document.querySelector('[data-demo-inspector]'),source:document.querySelector('[data-demo-source]')})`);
      if (state.id !== id || state.section !== id || state.inspector || state.source) {
        throw new Error(`${id} no-JavaScript workbench failed: ${JSON.stringify(state)}`);
      }
    }
  } finally {
    await cdp.call('Emulation.setScriptExecutionDisabled', { value: false });
  }
}

async function identitySplitAudit(cdp: CdpClient) {
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  for (const locale of ['en', 'ar']) {
    for (const id of ['oauth', 'sso', 'saml']) {
      const label = `${id} Identity 375px ${locale}`;
      await navigate(cdp, `${origin}/demos?lang=${locale}#${id}`);
      await assertWorkbenchState(cdp, id, label, `#${id}`, locale);
      const state = await evaluate(cdp, `(()=>{
        const root=document.querySelector('[data-demo-panel] [data-demo-section]');
        const chips=[...document.querySelectorAll('[data-demo-selector-category="Identity"] a')];
        const mark=[...root.querySelectorAll('.microsoft-mark span')].map((node)=>{const rect=node.getBoundingClientRect();return {width:rect.width,height:rect.height,color:getComputedStyle(node).backgroundColor}});
        return {overflow:document.documentElement.scrollWidth>innerWidth+1,providers:[...root.querySelectorAll('[data-provider-action]')].map((node)=>node.dataset.providerAction),
          chips:chips.map((node)=>node.textContent?.trim()),mark,metadata:Boolean(root.querySelector('a[href="/auth/saml/metadata"]')),
          samlConfigured:root.querySelector('[data-config-status="saml"]')?.dataset.configured,
          samlActionVisible:!root.querySelector('[data-provider-action="saml"]')?.hidden};
      })()`);
      const expected = id === 'oauth' ? ['github'] : id === 'sso' ? ['microsoft', 'google'] : ['saml'];
      if (state.overflow || JSON.stringify(state.providers) !== JSON.stringify(expected) || state.chips.length !== 3) throw new Error(`${label} split or reflow failed: ${JSON.stringify(state)}`);
      if (id === 'sso' && (state.mark.length !== 4 || state.mark.some((square)=>square.width < 8 || square.height < 8 || square.color === 'rgba(0, 0, 0, 0)'))) throw new Error(`${label} Microsoft mark failed: ${JSON.stringify(state.mark)}`);
      if (id === 'saml' && (!state.metadata || (state.samlConfigured === 'false' && state.samlActionVisible))) throw new Error(`${label} SAML configuration state failed: ${JSON.stringify(state)}`);
      await inspectCurrentPage(cdp, locale, label);
    }
  }
  await cdp.call('Emulation.setScriptExecutionDisabled', { value: true });
  try {
    for (const locale of ['en', 'ar']) {
      for (const id of ['oauth', 'sso', 'saml']) {
        await navigate(cdp, `${origin}/demos?lang=${locale}&demo=${id}#${id}`);
        const state = await evaluate(cdp, `({id:document.querySelector('[data-demo-workbench]')?.dataset.demoId,section:document.querySelector('[data-demo-panel] [data-demo-section]')?.dataset.demoSection,selected:document.querySelector('[data-demo-selector-category="Identity"] [aria-current="location"]')?.getAttribute('href'),overflow:document.documentElement.scrollWidth>innerWidth+1})`);
        if (state.id !== id || state.section !== id || !state.selected?.includes(`demo=${id}#${id}`) || state.overflow) throw new Error(`${id} no-JavaScript ${locale} fragment failed: ${JSON.stringify(state)}`);
      }
      await navigate(cdp, `${origin}/demos?lang=${locale}&demo=oauth#identity`);
      const alias = await evaluate(cdp, `({id:document.querySelector('[data-demo-workbench]')?.dataset.demoId,anchor:document.querySelector('#identity')?.getAttribute('href')})`);
      if (alias.id !== 'oauth' || !alias.anchor?.includes('demo=oauth#identity')) throw new Error(`Identity no-JavaScript alias failed: ${JSON.stringify(alias)}`);
    }
  } finally {
    await cdp.call('Emulation.setScriptExecutionDisabled', { value: false });
  }
}

async function exerciseD1TaskCardWorkflow(cdp: CdpClient, locale: string) {
  const label = `D1 task cards 375px ${locale}`;
  await navigate(cdp, `${origin}/demos?lang=${locale}#d1`);
  await assertWorkbenchState(cdp, 'd1', label, '#d1', locale);
  await waitForExpression(cdp, `document.querySelector('[data-count="tasks"]')?.textContent !== '—'`, `${label} loaded`);
  const id = await evaluate(cdp, `(()=>{
    document.querySelector('[data-table-tab="tasks"]').click();
    const button=document.querySelector('[data-rows="tasks"] [data-edit-task]');
    if(!button)throw new Error('No editable task card');
    button.click();
    const form=document.querySelector('[data-form="tasks"]');
    const status=form.querySelector('[name="status"]');
    status.value=status.value==='doing'?'done':'doing';
    form.requestSubmit();
    return button.getAttribute('data-edit-task');
  })()`);
  await waitForExpression(cdp, `document.querySelector('[data-form="tasks"]')?.hidden===true && document.querySelector('[data-inspector-verb]')?.textContent==='UPDATE'`, `${label} edited`, 160);
  await evaluate(cdp, `(()=>{document.querySelector('[data-delete-task=${JSON.stringify(id)}]').click();document.querySelector('[data-confirm-action]').click();return true})()`);
  await waitForExpression(cdp, `!document.querySelector('[data-delete-task=${JSON.stringify(id)}]') && document.querySelector('[data-inspector-verb]')?.textContent==='DELETE'`, `${label} deleted`, 160);
  await evaluate(cdp, `(()=>{document.querySelector('[data-demo-reset]').click();document.querySelector('[data-demo-reset-confirm]').click();return true})()`);
  await waitForExpression(cdp, `document.querySelector('[data-count="tasks"]')?.textContent !== '—' && !document.querySelector('[data-demo-reset-dialog]')?.open`, `${label} reset`, 160);
}

async function demoInteriorReflowAudit(cdp: CdpClient) {
  const affected = ['d1', 'r2', 'graphql', 'mcp', 'edge', 'workers', 'durable-objects'];
  for (const width of [320, 375, 768]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await cdp.call('Emulation.setTouchEmulationEnabled', { enabled: width < 768 });
    for (const locale of ['en', 'ar']) {
      for (const id of affected) {
        const label = `${id} interior ${width}px ${locale}`;
        await navigate(cdp, `${origin}/demos?lang=${locale}#${id}`);
        await assertWorkbenchState(cdp, id, label, `#${id}`, locale);
        if (id === 'd1') await waitForExpression(cdp, `document.querySelector('[data-count="users"]')?.textContent !== '—'`, `${label} rows`);
        const report = await evaluate(cdp, `(()=>{
          const root=document.querySelector('[data-demo-panel]');
          const rect=(selector)=>root.querySelector(selector)?.getBoundingClientRect();
          const visible=(node)=>node&&getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0;
          const actions=[...root.querySelectorAll('.button-primary,[data-copy-value],.graphql-example .button,.d1-row-actions button')].filter(visible);
          const smallActions=actions.filter((node)=>{const r=node.getBoundingClientRect();return r.width<43.5||r.height<43.5}).map((node)=>node.outerHTML.slice(0,90));
          const headings=[...root.querySelectorAll('.section-head,.lab-heading,.graphql-workspace-heading')].filter(visible);
          const misalignedHeadings=headings.filter((node)=>{const h=node.querySelector('h2,h3,h4');if(!h)return false;const a=node.getBoundingClientRect(),b=h.getBoundingClientRect();return document.dir==='rtl'?a.right-b.right>3:b.left-a.left>3}).map((node)=>node.className);
          const rows=[...root.querySelectorAll('[data-rows="users"] tr,[data-rows="tasks"] tr')].filter((row)=>visible(row)&&row.querySelector('[data-edit-user],[data-edit-task]'));
          const clippedEmails=[...root.querySelectorAll('[data-rows="users"] td code')].filter((node)=>node.scrollWidth>node.clientWidth+1).map((node)=>node.textContent);
          const d1Buttons=rows.flatMap((row)=>[...row.querySelectorAll('.d1-row-actions button')]).filter((node)=>{const r=node.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.width<43.5||r.height<43.5}).length;
          const flow=root.querySelector('.durable-flow');
          const checkbox=root.querySelector('.worker-policy-check input');
          const checkboxLabel=checkbox?.closest('label');
          const checkboxText=checkboxLabel?.lastChild;
          const textRange=checkboxText&&document.createRange();if(textRange)textRange.selectNodeContents(checkboxText);
          const checkRect=checkbox?.getBoundingClientRect(),textRect=textRange?.getBoundingClientRect();
          const editor=rect('[data-graphql-form] textarea'),form=rect('[data-graphql-form]');
          const heading=rect('.edge-request-flow .lab-heading :is(h2,h3)'),edgeButton=rect('[data-edge-run]');
          const endpoint=root.querySelector('[data-mcp-endpoint]');
          return {overflow:document.documentElement.scrollWidth>innerWidth+1,smallActions,misalignedHeadings,
            d1Cards:rows.length&&rows.every((row)=>getComputedStyle(row).display==='grid'),d1Buttons,clippedEmails,
            flowColumns:flow?getComputedStyle(flow).gridTemplateColumns.trim().split(/\\s+/).length:null,
            flowClipped:flow?[...flow.querySelectorAll('strong')].some((node)=>node.scrollWidth>node.clientWidth+1):false,
            edgeActionBelow:heading&&edgeButton?edgeButton.top>=heading.bottom-1:null,
            mcpEndpointVisible:visible(endpoint),mcpActionBelow:rect('[data-copy-value]')&&rect('[data-copy-value]').top>=root.querySelector('[data-copy-value]')?.closest('section')?.querySelector('.section-head :is(h2,h3)')?.getBoundingClientRect().bottom-1,
            editorRatio:editor&&form?editor.width/form.width:null,
            workerInline:checkRect&&textRect?Math.abs((checkRect.top+checkRect.bottom)/2-(textRect.top+textRect.bottom)/2)<10:null,
            coarseCopy:root.querySelector('.drop-zone-pointer-coarse')?.textContent?.trim(),
            coarseVisible:visible(root.querySelector('.drop-zone-pointer-coarse'))};
        })()`);
        const failures=[];
        if (report.overflow) failures.push('root overflow');
        if (report.smallActions.length) failures.push(`small actions ${report.smallActions.join(', ')}`);
        if (width < 640 && report.misalignedHeadings.length) failures.push(`heading alignment ${report.misalignedHeadings.join(', ')}`);
        if (id === 'd1' && (report.d1Buttons || report.clippedEmails.length || (width < 640 && !report.d1Cards))) failures.push('D1 cards, actions, or email clipping');
        if (id === 'durable-objects' && width < 640 && (report.flowColumns !== 1 || report.flowClipped)) failures.push('Durable Objects flow');
        if (id === 'edge' && width < 640 && !report.edgeActionBelow) failures.push('Edge action placement');
        if (id === 'mcp' && (!report.mcpEndpointVisible || (width < 640 && !report.mcpActionBelow))) failures.push('MCP endpoint or action placement');
        if (id === 'graphql' && (report.editorRatio < .95 || !Number.isFinite(report.editorRatio))) failures.push('GraphQL editor width');
        if (id === 'workers' && !report.workerInline) failures.push('Workers checkbox alignment');
        if (id === 'r2' && width < 768 && (!report.coarseVisible || !report.coarseCopy || (locale === 'ar' && !/[\u0600-\u06ff]/.test(report.coarseCopy)))) failures.push('R2 touch copy');
        if (failures.length) throw new Error(`${label}: ${failures.join('; ')} (${JSON.stringify(report)})`);
        if (id === 'd1') {
          const tasks = await evaluate(cdp, `(()=>{
            document.querySelector('[data-table-tab="tasks"]').click();
            const rows=[...document.querySelectorAll('[data-rows="tasks"] tr')].filter((row)=>row.querySelector('[data-edit-task]'));
            const actions=rows.flatMap((row)=>[...row.querySelectorAll('.d1-row-actions button')]);
            return {cards:rows.length>0&&rows.every((row)=>getComputedStyle(row).display==='grid'),
              clipped:actions.some((node)=>{const r=node.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.width<43.5||r.height<43.5})};
          })()`);
          if (tasks.clipped || (width < 640 && !tasks.cards)) throw new Error(`${label}: task card actions are clipped or missing (${JSON.stringify(tasks)})`);
        }
      }
      if (width === 375) {
        await exerciseD1Workflow(cdp, locale);
        await exerciseD1TaskCardWorkflow(cdp, locale);
      }
    }
  }
  await cdp.call('Emulation.setTouchEmulationEnabled', { enabled: false });
}

async function retainedInspectorAudit(cdp: CdpClient) {
  const retained = ['d1', 'r2', 'workers', 'durable-objects', 'i18n'];
  for (const width of [375, 768, 1280, 1440]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    for (const locale of ['en', 'ar']) {
      for (const id of width > 900 ? ['d1'] : retained) {
        const label = `${id} inspector ${width}px ${locale}`;
        await navigate(cdp, `${origin}/demos?lang=${locale}#${id}`);
        await assertWorkbenchState(cdp, id, label, `#${id}`, locale);

        const geometry = await settledGeometry(() => evaluate(cdp, `(()=>{
          const stage=document.querySelector('.demo-stage').getBoundingClientRect();
          const inspector=document.querySelector('[data-demo-inspector]');
          const rect=inspector.getBoundingClientRect();
          const toggle=document.querySelector('[data-demo-inspector-toggle]');
          return {position:getComputedStyle(inspector).position,stageEnd:stage.right,stageStart:stage.left,stageTop:stage.top,stageBottom:stage.bottom,scroll:scrollY,
            sideStart:rect.left,sideEnd:rect.right,toggleVisible:getComputedStyle(toggle).display!=='none',
            overflow:document.documentElement.scrollWidth>innerWidth+1};
        })()`), label);
        if (geometry.overflow) throw new Error(`${label} overflow: ${JSON.stringify(geometry)}`);
        if (width > 900) {
          const beside = locale === 'ar' ? geometry.sideEnd <= geometry.stageStart + 2 : geometry.sideStart >= geometry.stageEnd - 2;
          if (geometry.position !== 'sticky' || !beside || geometry.toggleVisible) throw new Error(`${label} sticky side column failed: ${JSON.stringify(geometry)}`);
          const sticky = await evaluate(cdp, `(()=>{
            const stage=document.querySelector('.demo-stage');
            const side=document.querySelector('[data-demo-inspector]');
            const maxScroll=document.documentElement.scrollHeight-innerHeight;
            const stageTop=stage.getBoundingClientRect().top+scrollY;
            scrollTo({top:Math.min(maxScroll,stageTop+400),behavior:'instant'});
            const first=side.getBoundingClientRect().top;
            scrollTo({top:Math.min(maxScroll,stageTop+550),behavior:'instant'});
            return {first,second:side.getBoundingClientRect().top,scroll:scrollY,maxScroll};
          })()`);
          if (sticky.scroll < 500 || sticky.first < 0 || Math.abs(sticky.second-sticky.first)>2) throw new Error(`${label} inspector did not remain sticky while scrolling: ${JSON.stringify(sticky)}`);
          continue;
        }
        if (geometry.position !== 'fixed' || !geometry.toggleVisible) throw new Error(`${label} off-canvas setup failed: ${JSON.stringify(geometry)}`);
        const beforeOpen = await evaluate(cdp, `(()=>{
          const toggle=document.querySelector('[data-demo-inspector-toggle]');
          toggle.scrollIntoView({ behavior: 'instant' });const before=scrollY;toggle.click();
          return {before,after:scrollY};
        })()`);
        await waitForExpression(cdp, `document.querySelector('[data-demo-inspector]')?.dataset.open==='true' && document.activeElement===document.querySelector('[data-demo-inspector-close]') && !document.querySelector('[data-demo-inspector]').getAnimations({subtree:true}).some((animation)=>animation.playState==='running')`, `${label} inspector open and focus`);
        const opened = await evaluate(cdp, `(()=>{
          const toggle=document.querySelector('[data-demo-inspector-toggle]');
          const side=document.querySelector('[data-demo-inspector]').getBoundingClientRect();
          return {expanded:toggle.getAttribute('aria-expanded'),controls:toggle.getAttribute('aria-controls'),
            open:document.querySelector('[data-demo-inspector]').dataset.open,
            focus:document.activeElement?.hasAttribute('data-demo-inspector-close'),active:document.activeElement?.outerHTML.slice(0,120),
            inert:document.querySelector('[data-demo-inspector]').inert,detailsOpen:document.querySelector('[data-demo-inspector-disclosure]').open,
            closeDisplay:getComputedStyle(document.querySelector('[data-demo-inspector-close]')).display,
            scroll:scrollY,sideStart:side.left,sideEnd:side.right};
        })()`);
        const inlineEnd = locale === 'ar' ? opened.sideStart >= -1 : opened.sideEnd <= width + 1;
        if (opened.expanded !== 'true' || opened.controls !== 'demo-inspector' || opened.open !== 'true' || !opened.focus || Math.abs(beforeOpen.before-beforeOpen.after)>2 || Math.abs(opened.scroll-beforeOpen.after)>2 || !inlineEnd) throw new Error(`${label} open failed: ${JSON.stringify({ ...opened, beforeOpen })}`);
        await dispatchKey(cdp, 'Escape', 'Escape');
        const escaped = await evaluate(cdp, `({expanded:document.querySelector('[data-demo-inspector-toggle]').getAttribute('aria-expanded'),focused:document.activeElement===document.querySelector('[data-demo-inspector-toggle]')})`);
        if (escaped.expanded !== 'false' || !escaped.focused) throw new Error(`${label} Escape focus return failed: ${JSON.stringify(escaped)}`);
        const closed = await evaluate(cdp, `(()=>{document.querySelector('[data-demo-inspector-toggle]').click();document.querySelector('[data-demo-inspector-close]').click();return {expanded:document.querySelector('[data-demo-inspector-toggle]').getAttribute('aria-expanded'),focused:document.activeElement===document.querySelector('[data-demo-inspector-toggle]')}})()`);
        if (closed.expanded !== 'false' || !closed.focused) throw new Error(`${label} close focus return failed: ${JSON.stringify(closed)}`);
        if (id === 'd1') {
          await evaluate(cdp, `document.querySelector('[data-demo-inspector-toggle]').click();true`);
          await waitForExpression(cdp, `document.querySelector('[data-demo-inspector]')?.dataset.open==='true' && document.activeElement===document.querySelector('[data-demo-inspector-close]') && !document.querySelector('[data-demo-inspector]').getAnimations({subtree:true}).some((animation)=>animation.playState==='running')`, `${label} inspector open and focus`);
          const access = await evaluate(cdp, `(async()=>{
            ${axeSource}
            const side=document.querySelector('[data-demo-inspector]');
            const close=document.querySelector('[data-demo-inspector-close]');
            const rect=close.getBoundingClientRect();
            const result=await axe.run(side,{runOnly:{type:'tag',values:${JSON.stringify(axeTags)}},resultTypes:['violations']});
            return {violations:result.violations.map((item)=>item.id),focus:document.activeElement===close,
              visible:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight};
          })()`);
          if (access.violations.length || !access.focus || !access.visible) throw new Error(`${label} open panel accessibility failed: ${JSON.stringify(access)}`);
          await dispatchKey(cdp, 'Escape', 'Escape');
        }
      }
    }
  }
}

async function keyboardSmoke(cdp: CdpClient, pathname: string) {
  await navigate(cdp, `${origin}${localizedPath(pathname, 'en')}`);
  await waitForCurrentPageReady(cdp, pathname, 'en', `${pathname} keyboard readiness`);
  await evaluate(cdp, `document.body.focus(); document.activeElement?.blur(); true`);
  const visited = [];
  for (let index = 0; index < 8; index += 1) {
    await dispatchKey(cdp, 'Tab', 'Tab');
    visited.push(await evaluate(cdp, `document.activeElement ? (document.activeElement.id || document.activeElement.getAttribute('data-theme-toggle') || document.activeElement.tagName + ':' + (document.activeElement.textContent||'').trim().slice(0,30)) : ''`));
  }
  if (new Set(visited.filter(Boolean)).size < 2) throw new Error(`${pathname}: keyboard focus did not advance through multiple controls`);

  const themeBefore = await evaluate(cdp, `(()=>{const b=document.querySelector('[data-theme-toggle]'); if(!b)return null; b.focus(); return b.getAttribute('aria-pressed')})()`);
  if (themeBefore !== null) {
    await dispatchKey(cdp, ' ', 'Space');
    const themeAfter = await evaluate(cdp, `document.querySelector('[data-theme-toggle]')?.getAttribute('aria-pressed') ?? null`);
    if (themeAfter === themeBefore) throw new Error(`${pathname}: theme control did not activate from the keyboard`);
  }

  const disclosure = await evaluate(cdp, `(()=>{const s=[...document.querySelectorAll('details > summary')].find((node)=>{const r=node.getBoundingClientRect();const style=getComputedStyle(node);return r.width>0&&r.height>0&&style.visibility!=='hidden'}); if(!s)return null; s.focus(); return s.parentElement.open})()`);
  if (disclosure !== null) {
    await dispatchKey(cdp, ' ', 'Space');
    await sleep(50);
    const disclosureAfter = await evaluate(cdp, `document.activeElement?.matches('details > summary') ? document.activeElement.parentElement.open : null`);
    if (disclosureAfter === disclosure) throw new Error(`${pathname}: disclosure did not activate from the keyboard`);
  }

  // Keep the locale selector last: its change handler intentionally navigates,
  // so subsequent checks would otherwise race the replacement document.
  const languageBefore = await evaluate(cdp, `(()=>{const s=document.querySelector('#global-language'); if(!s)return null; s.focus(); return s.selectedIndex})()`);
  if (languageBefore !== null) {
    const loaded = cdp.once('Page.loadEventFired', {
      label: `${pathname} language-selector load`,
      timeoutMs: 30_000,
    });
    // Native select typeahead exercises a real keyboard selection without relying
    // on an OS popup, which headless macOS Chromium does not operate with ArrowDown.
    await cdp.call('Input.dispatchKeyEvent', { type: 'char', key: 'f', text: 'f', unmodifiedText: 'f' });
    try { await loaded; } catch (error) {
      const state = await evaluate(cdp, `({lang:document.documentElement.lang,selected:document.querySelector('#global-language')?.selectedIndex,focused:document.activeElement?.id,pathname:location.pathname})`);
      throw new Error(`${pathname}: language selector navigation failed; state=${JSON.stringify(state)}; ${error instanceof Error ? error.message : String(error)}`);
    }
    const languageAfter = await evaluate(cdp, `({selected:document.querySelector('#global-language')?.selectedIndex,lang:document.documentElement.lang})`);
    if (languageAfter.selected === languageBefore || languageAfter.lang !== 'fr') throw new Error(`${pathname}: language selector did not respond to keyboard navigation`);
  }
}

async function liveWebhookReflowAudit(cdp: CdpClient) {
  for (const width of [375, 1280]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    for (const locale of ['en', 'ar']) {
      const label = `live Webhooks ${width}px ${locale}`;
      await navigate(cdp, `${origin}/demos?lang=${locale}#webhooks`);
      await assertWorkbenchState(cdp, 'webhooks', label, '#webhooks', locale);
      const result = await evaluate(cdp, `(()=>{
        const panel=document.querySelector('[data-live-git]');
        const feed=panel?.querySelector('[data-live-feed]');
        if(!panel||!feed)return {missing:true};
        const fixture=document.createElement('article');fixture.className='webhook-live-item';
        fixture.textContent='validate · completed · success · 2026-09-30T12:00:00Z · 2026-09-30T12:02:00Z · aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const nested=document.createElement('ol');nested.className='webhook-live-steps';
        for(const value of ['Install locked dependencies','Run complete acceptance and security validation']){
          const item=document.createElement('li');item.className='webhook-live-item';item.textContent=value+' · in_progress · 2026-09-30T12:00:00Z';nested.append(item);
        }
        fixture.append(nested);feed.append(fixture);
        const panelRect=panel.getBoundingClientRect();
        const clipped=[...panel.querySelectorAll('button,input,select,.webhook-live-item,.webhook-live-lifecycle li')].filter((item)=>{const rect=item.getBoundingClientRect();return rect.left < -1 || rect.right > innerWidth+1}).map((item)=>item.tagName);
        return {missing:false,overflow:document.documentElement.scrollWidth>innerWidth+1,panelLeft:panelRect.left,panelRight:panelRect.right,clipped,lang:document.documentElement.lang,dir:document.documentElement.dir};
      })()`);
      if (result.missing || result.overflow || result.panelLeft < -1 || result.panelRight > width + 1 || result.clipped.length || result.lang !== locale || result.dir !== (locale === 'ar' ? 'rtl' : 'ltr')) {
        throw new Error(`${label} failed: ${JSON.stringify(result)}`);
      }
    }
  }
}

async function browserFailureAudit(cdp: CdpClient) {
  const mustFail = async (label: string, action: () => Promise<unknown>, message: string) => {
    try { await action(); } catch (error) {
      if (error instanceof Error && error.message.includes(message)) {
        console.log(`Browser deliberate defect rejected: ${label}`);
        return;
      }
      throw error;
    }
    throw new Error(`Browser deliberate defect escaped: ${label}`);
  };
  await navigate(cdp, `${origin}/demos?lang=en#d1`);
  await assertWorkbenchState(cdp, 'd1', 'negative fixture ready');
  await evaluate(cdp, `document.querySelector('[data-demo-reset]').focus();true`);
  await mustFail('wrong category focus', async () => requireCategoryFocus(await evaluate(cdp, `(()=>{const selected=document.querySelector('[data-demo-category][aria-selected="true"]');return {selected:selected?.dataset.demoCategory,focused:document.activeElement?.dataset.demoCategory,selectedFocused:document.activeElement===selected}})()`), 'negative focus'), 'does not own keyboard focus');
  await evaluate(cdp, `(()=>{const selected=document.querySelector('[data-demo-category][aria-selected="true"]');selected.focus();window.__blockedCategoryKey=(event)=>{event.preventDefault();event.stopImmediatePropagation()};selected.addEventListener('keydown',window.__blockedCategoryKey,{capture:true});return true})()`);
  try {
    await dispatchKey(cdp, 'ArrowRight');
    await mustFail('broken category navigation', () => assertWorkbenchState(cdp, 'rest', 'negative navigation', '#rest', 'en', 150), 'workbench mount timed out');
  } finally { await evaluate(cdp, `document.querySelector('[data-demo-category][aria-selected="true"]').removeEventListener('keydown',window.__blockedCategoryKey,{capture:true});delete window.__blockedCategoryKey;true`); }
  await evaluate(cdp, `delete document.querySelector('[data-demo-workbench]').dataset.demoMounted;true`);
  try {
    await mustFail('missing workbench mount', () => assertWorkbenchState(cdp, 'd1', 'negative mount', '#d1', 'en', 150), 'workbench mount timed out');
  } finally { await evaluate(cdp, `document.querySelector('[data-demo-workbench]').dataset.demoMounted='true';true`); }
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
}

async function runAudit() {
  const pages = publicPages();
  if (!pages.length) throw new Error('Expected application-wide public-page coverage, found no registered public pages');
  if (!pages.some((route) => route.id === 'demos.index')) throw new Error('Application-wide browser coverage is missing the consolidated demos route');
  for (const state of auditConfig.states) {
    const pathname = new URL(state.path, origin).pathname;
    if (!pages.some((route) => patternMatches(route.route, pathname))) {
      throw new Error(`Audit state '${state.name}' is not owned by a canonical public route: ${state.path}`);
    }
  }

  if (ownedPersistenceDirectory && runCleanLocalMigrations({ persistenceDirectory: ownedPersistenceDirectory }) !== 0) {
    throw new Error('Could not apply the pinned schema to the audit-owned local D1.');
  }
  const wranglerBin = path.resolve('node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
  // Sessions derive their keys from the WG_SESSION_KEY Secrets Store binding, which local dev simulates per persistence directory.
  const sessionKeyStore = parseJsonc(fs.readFileSync('wrangler.jsonc', 'utf8')).secrets_store_secrets
    ?.find((entry) => entry.binding === 'WG_SESSION_KEY')?.store_id;
  if (!sessionKeyStore) throw new Error('wrangler.jsonc does not bind WG_SESSION_KEY from the Secrets Store.');
  const seeded = spawnSync(wranglerBin, [
    'secrets-store', 'secret', 'create', sessionKeyStore,
    '--name', 'WG_SESSION_KEY', '--value', localSessionSecret, '--scopes', 'workers', ...localPersistenceArgs,
  ], { encoding: 'utf8', env: { ...process.env, NO_UPDATE_NOTIFIER: '1' } });
  if (seeded.status !== 0) throw new Error(`Could not seed the local WG_SESSION_KEY: ${seeded.stderr.trim().split('\n').at(-1)}`);
  const wrangler = spawn(wranglerBin, [
    'dev',
    '--local',
    ...localPersistenceArgs,
    '--ip',
    '127.0.0.1',
    '--port',
    String(serverPort),
    '--var',
    'DEMO_WEBHOOK_SECRET:demo-384-local-browser-audit-webhook-secret',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  });
  let wranglerError = '';
  wrangler.stdout.resume();
  wrangler.stderr.on('data', (chunk) => { wranglerError += String(chunk); });

  let chrome;
  let cdp;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-site-audit-'));
  try {
    await waitForUrl(`${origin}/`);
    const executable = chromeExecutable('test:site-accessibility');
    chrome = spawn(executable, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--window-size=1280,1000',
      'about:blank',
    ], { stdio: 'ignore' });
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`);
    const target = await waitForPageTarget(debugPort);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Log.enable');
    await cdp.call('Audits.enable');
    const cspViolations = [];
    cdp.on('Log.entryAdded', (_method, { entry }) => {
      if (/content security policy|content-security-policy|violates the following directive/i.test(entry?.text ?? '')) {
        cspViolations.push(`${entry?.url ?? 'unknown URL'}: ${entry?.text ?? 'security console entry'}`);
      }
    });
    cdp.on('Audits.issueAdded', (_method, { issue }) => {
      if (issue?.code === 'ContentSecurityPolicyIssue') {
        cspViolations.push(`CSP browser issue: ${JSON.stringify(issue.details?.contentSecurityPolicyIssueDetails ?? {})}`);
      }
    });
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

    await browserFailureAudit(cdp);
    if (process.argv.includes('--focused')) {
      for (let repetition = 1; repetition <= 3; repetition += 1) {
        await workbenchInteractionAudit(cdp);
        console.log(`Focused keyboard repetition ${repetition}/3 passed`);
      }
      return;
    }

    let browserPages = 0;
    let axeRuns = 0;
    const enhancedTargetSummary = [];
    const mergedDemo289Coverage = new Set();
    const mergedDemo289MediaCoverage = new Set();
    const mergedDemo289Findings = [];
    const mergedDemo289Scope = [...new Set([...pages.map(routePath), ...auditConfig.states.map((state) => state.path)].map((pathname) => localizedPath(pathname, 'en')))];
    const renderedVisits = new Set<string>();
    for (const route of pages) {
      const pathname = routePath(route);
      for (const locale of ['en', 'ar']) {
        renderedVisits.add(localizedPath(pathname, locale));
        const report = await inspectPath(cdp, pathname, locale, `${route.id} ${locale}`, { checkTargetSize: true });
        enhancedTargetSummary.push({ pathname, locale, below44: report.targetSize.below44, total: report.targetSize.total });
        await runMergedDemo289Checks(cdp, pathname, locale, mergedDemo289Coverage, mergedDemo289MediaCoverage, mergedDemo289Findings);
        browserPages += 1;
        axeRuns += 1;
      }
    }

    for (const state of auditConfig.states) {
      for (const locale of ['en', 'ar']) {
        const visit = localizedPath(state.path, locale);
        if (renderedVisits.has(visit)) continue;
        renderedVisits.add(visit);
        const report = await inspectPath(cdp, state.path, locale, `${state.name} ${locale}`, { checkTargetSize: true });
        enhancedTargetSummary.push({ pathname: state.path, locale, below44: report.targetSize.below44, total: report.targetSize.total });
        await runMergedDemo289Checks(cdp, state.path, locale, mergedDemo289Coverage, mergedDemo289MediaCoverage, mergedDemo289Findings);
        axeRuns += 1;
      }
    }

    await inspectPath(cdp, '/', 'en', 'home dark theme');
    axeRuns += 1;
    await evaluate(cdp, `localStorage.setItem('wg-theme', 'light')`);
    await inspectPath(cdp, '/', 'en', 'stored light theme');
    if (await evaluate(cdp, `document.documentElement.dataset.theme`) !== 'light') {
      throw new Error('Stored light theme was not restored by the blocking head script');
    }
    await evaluate(cdp, `localStorage.removeItem('wg-theme')`);
    await evaluate(cdp, `(async()=>{
      document.documentElement.dataset.theme='light';
      await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await Promise.all(document.getAnimations().map((animation)=>animation.finished.catch(()=>{})));
      return true;
    })()`);
    await inspectCurrentPage(cdp, 'en', 'home light theme');
    axeRuns += 1;

    await workbenchInteractionAudit(cdp);
    await accessibilityGeometryAudit(cdp);
    await sharedResetAudit(cdp, 1280);
    axeRuns += 6;
    await phoneWorkbenchAudit(cdp);
    await restDocumentReflowAudit(cdp);
    await identitySplitAudit(cdp);
    await demoInteriorReflowAudit(cdp);
    await retainedInspectorAudit(cdp);
    await sharedResetAudit(cdp, 375);
    await liveWebhookReflowAudit(cdp);

    for (const pathname of auditConfig.narrowViewportPaths) {
      const isWorkbench = new URL(pathname, origin).pathname === manifest.find((route) => route.id === 'demos.index')?.route;
      for (const locale of isWorkbench ? ['en', 'ar'] : ['en']) {
        await cdp.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
        await inspectPath(cdp, pathname, locale, `${pathname} ${locale} 320px`);
        if (isWorkbench) {
          const expectedId = new URL(pathname, origin).hash.slice(1) || 'd1';
          await assertWorkbenchState(cdp, expectedId, `${pathname} ${locale} narrow workbench`, `#${expectedId}`, locale);
          const reflow = await evaluate(cdp, `(()=>{
            const inspector=document.querySelector('.demo-inspector');
            const layout=document.querySelector('.demo-workbench-layout');
            return {inspectorPosition:inspector&&getComputedStyle(inspector).position,inspectorVisibility:inspector&&getComputedStyle(inspector).visibility,columns:layout ? getComputedStyle(layout).gridTemplateColumns : ''};
          })()`);
          const retainedInspector = ['d1', 'r2', 'workers', 'durable-objects', 'i18n'].includes(expectedId);
          if ((retainedInspector && !(reflow.inspectorPosition === 'fixed' && reflow.inspectorVisibility === 'hidden')) || reflow.columns.trim().split(/\s+/).length !== 1) {
            throw new Error(`${pathname} ${locale}: workbench inspector did not dock off canvas (${JSON.stringify(reflow)})`);
          }
        }
        axeRuns += 1;
      }
    }
    for (const width of [320, 375, 430, 768, 1280]) {
      await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      for (const locale of width === 320 ? ['en', 'es', 'fr', 'de', 'ja', 'ar'] : ['en', 'de', 'ar']) {
        await navigate(cdp, `${origin}${localizedPath(demosPath, locale)}`);
        await inspectShellGeometry(cdp, `shared shell ${width}px ${locale}`);
      }
    }
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
    await cdp.call('Emulation.setScriptExecutionDisabled', { value: true });
    try {
      await navigate(cdp, `${origin}/?lang=en`);
      const fallback = await evaluate(cdp, `(()=>{
        const disclosure=document.querySelector('.nojs-utilities');
        disclosure.open=true;
        const theme=disclosure.querySelector('.theme-nojs input');
        theme.click();
        const rect=disclosure.querySelector('summary').getBoundingClientRect();
        return {theme:getComputedStyle(document.body).colorScheme,locale:Boolean(disclosure.querySelector('select[name="lang"]')),submit:Boolean(disclosure.querySelector('button[type="submit"]')),summaryWidth:rect.width,summaryHeight:rect.height,overflow:document.documentElement.scrollWidth>innerWidth+1};
      })()`);
      if(fallback.theme!=='light'||!fallback.locale||!fallback.submit||fallback.summaryWidth<44||fallback.summaryHeight<44||fallback.overflow){
        throw new Error(`No-JavaScript theme/language controls failed at 320px: ${JSON.stringify(fallback)}`);
      }
      const loaded=cdp.once('Page.loadEventFired',{label:'no-JavaScript language switch',timeoutMs:30000});
      await evaluate(cdp, `(()=>{const form=document.querySelector('.nojs-utilities .language-selector');form.querySelector('select').value='ar';form.requestSubmit();return true})()`);
      await loaded;
      if(await evaluate(cdp, `document.documentElement.lang`) !== 'ar')throw new Error('No-JavaScript language form did not switch locale.');
    } finally {
      await cdp.call('Emulation.setScriptExecutionDisabled', { value: false });
    }
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

    for (const pathname of auditConfig.keyboardPaths) await keyboardSmoke(cdp, pathname);

    const expectedMergedDemo289Coverage = mergedDemo289Scope.length * 2;
    const expectedMergedDemo289MediaCoverage = mergedDemo289Scope.length;
    if (mergedDemo289Coverage.size !== expectedMergedDemo289Coverage || mergedDemo289MediaCoverage.size !== expectedMergedDemo289MediaCoverage) {
      throw new Error(`Merged DEMO-289 coverage incomplete: visits=${mergedDemo289Coverage.size}/${expectedMergedDemo289Coverage} media=${mergedDemo289MediaCoverage.size}/${expectedMergedDemo289MediaCoverage}`);
    }
    const expectedMergedDemo289Findings = mergedDemo289Findings.filter((finding)=>finding.classification==='expected/documented finding');
    const unrecordedMergedDemo289Findings = mergedDemo289Findings.filter((finding)=>finding.classification==='new/unrecorded regression');
    console.log(`Merged DEMO-289 coverage: ${mergedDemo289Coverage.size} English/Arabic page-state visits, ${mergedDemo289MediaCoverage.size} English media checks, findings=${JSON.stringify({expectedDocumented:expectedMergedDemo289Findings,newUnrecorded:unrecordedMergedDemo289Findings})}`);
    if (unrecordedMergedDemo289Findings.length) throw new Error(`Merged DEMO-289 coverage found ${unrecordedMergedDemo289Findings.length} new/unrecorded browser regression(s).`);

    if (cspViolations.length) {
      throw new Error(`CSP violations across audited pages/states: ${cspViolations.slice(0, 12).join('; ')}`);
    }

    console.log(`Site browser target-size review: ${JSON.stringify(enhancedTargetSummary)}`);
    console.log(`Site browser audit passed: ${pages.length} canonical public routes, ${browserPages} route/locale renders, ${auditConfig.states.length} explicit state fixtures, ${axeRuns} axe runs, no CSP violations, one complete Demo Workbench interaction/history/locale audit, D1 CRUD/reset, R2 upload/preview/delete, every REST operation, GraphQL example/custom queries, and the MCP, Edge, Workers, Durable Objects, accessibility/axe, and internationalization workflows in English and Arabic, ${auditConfig.narrowViewportPaths.length} narrow reflow samples, and ${auditConfig.keyboardPaths.length} keyboard smoke samples.`);
    console.log('Automated accessibility result: no automatically detectable violation observed in the bounded Chromium/axe matrix. This is not WCAG conformance or AAA certification.');
  } catch (error) {
    if (wrangler.exitCode !== null) console.error(`wrangler exited ${wrangler.exitCode}: ${wranglerError.slice(-4000)}`);
    throw error;
  } finally {
    await cdp?.close();
    await terminateProcess(chrome);
    await terminateProcess(wrangler);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function main() {
  const started = Date.now();
  console.log('site-browser-audit start');
  try { await runAudit(); }
  finally {
    if (ownedPersistenceDirectory) fs.rmSync(ownedPersistenceDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    console.log(`site-browser-audit finished: ${Date.now() - started}ms`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
