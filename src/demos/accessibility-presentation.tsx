import { sourceUrl } from '../lib/github';
import type { LocalizationContext } from '../i18n/runtime';
import { localizationForEnv } from '../i18n/runtime';
import { routeUrl } from '../routing/application-routes';
import type { Env } from '../types';
import { browserAssetName } from '../ui/asset-map';
import type { DemoSection, DemoSectionOptions } from '../ui/demo-section';
import { DemoHeading, useDemoPresentationScope } from '../ui/demo-presentation-scope';
import { routeSourceReference } from '../ui/page';
import { createReactDemoSection } from '../ui/react-demo-section';
import { ReferenceDetails } from '../ui/reference-details';

interface BehaviorComparison {
  criterion: string;
  name: string;
  working: string;
  failure: string;
  fixture: string;
  verification: string;
}

const behaviors: readonly BehaviorComparison[] = [
  { criterion: '2.1.1 · 2.4.3', name: 'Keyboard navigation', working: 'Use Tab and Shift+Tab through native controls in a logical order.', failure: 'A pointer-only control excludes keyboard operation.', fixture: '<div onclick="submitRelease()">Submit</div>', verification: 'Keyboard walkthrough plus semantic-control inspection.' },
  { criterion: '2.4.7 · 2.4.13', name: 'Focus visibility', working: 'Every control displays the shared three-pixel focus indicator.', failure: 'Removing the outline hides the current keyboard position.', fixture: '*:focus { outline: none !important; }', verification: 'Manual keyboard check; CSS inspection supports but cannot replace it.' },
  { criterion: '2.4.11', name: 'Focus not obscured', working: 'Focused content remains clear of the persistent footer.', failure: 'A fixed overlay can cover the focused control.', fixture: 'footer { position: fixed; bottom: 0; }\n/* no content clearance */', verification: 'Manual focus traversal at representative viewport sizes.' },
  { criterion: 'APG dialog · 2.4.3', name: 'Modal behavior', working: 'Open Sign in options, use Tab and Escape, and confirm focus returns.', failure: 'An unlabeled overlay has no modal semantics or focus management.', fixture: '<div class="overlay"><h2>Options</h2>...</div>', verification: 'Keyboard interaction plus role, name, and aria-modal inspection.' },
  { criterion: '1.1.1', name: 'Image alternative', working: 'The deployment illustration has a concise bounded alternative.', failure: 'Omitting alt leaves the image without a programmatic alternative.', fixture: '<img src="deployment-tiles.svg">', verification: 'DOM inspection plus judgment that the alternative fits the context.' },
  { criterion: '1.3.1 · 3.3.2', name: 'Landmarks and labels', working: 'Regions are semantic and every input has an associated label.', failure: 'Generic containers and placeholder-only inputs lose structure.', fixture: '<div class="main"><input placeholder="Email"></div>', verification: 'Automated name/role checks plus screen-reader structure review.' },
  { criterion: '2.5.5 · 2.5.8', name: 'Target size', working: 'Interactive targets meet the shared 44 by 44 CSS-pixel baseline.', failure: 'Adjacent undersized buttons are difficult to operate accurately.', fixture: '.tiny button { width: 18px; height: 18px; }', verification: 'Computed-size inspection at desktop and mobile widths.' },
  { criterion: '1.4.3 · 1.4.6 · 1.4.11', name: 'Contrast', working: 'Text and non-text states use the tested light and dark palette.', failure: 'A low-contrast foreground can make instructions unreadable.', fixture: '.hint { color: #aaa; background: #fff; }', verification: 'Contrast calculation plus manual inspection of non-text states.' },
  { criterion: '3.3.7', name: 'Redundant entry', working: 'The previously supplied email remains populated.', failure: 'Requiring the same information again creates avoidable work.', fixture: '<input name="email" value=""> <!-- repeated step -->', verification: 'Complete the flow and confirm previously entered data persists.' },
  { criterion: '3.3.8 · 3.3.9', name: 'Accessible authentication', working: 'Paste, password managers, saved passwords, and passkeys remain available.', failure: 'Paste blocking or a cognitive puzzle can prevent authentication.', fixture: '<input type="password" onpaste="return false">\n<p>Solve 9 × 7 to continue.</p>', verification: 'Manual paste/password-manager check; automation cannot prove usability.' },
  { criterion: '2.5.7', name: 'Dragging alternatives', working: 'Move up and Move down buttons accompany the draggable task.', failure: 'A drag-only interaction has no single-pointer alternative.', fixture: '<li draggable="true">Verify health check</li>', verification: 'Operate the equivalent action without a dragging gesture.' },
  { criterion: '3.2.6', name: 'Consistent help', working: 'Account help remains in the same predictable location.', failure: 'Removing or moving help between steps makes it harder to find.', fixture: '<!-- help link omitted from this step -->', verification: 'Manual comparison across the representative workflow.' },
] as const;

function AccessibilityPresentation({ env, localization }: Readonly<{ env: Env; localization: LocalizationContext }>) {
  const scope = useDemoPresentationScope();
  const exact = (english: string) => localization.exact(english);
  const interactionHeading = scope.id('interaction-heading');
  const scanHeading = scope.id('scan-heading');
  const criteriaHeading = scope.id('criteria-heading');
  return <>
    <section className="page-header">
      <DemoHeading level={1}>{exact('Accessibility is behavior.')}</DemoHeading>
      <p className="lede">{exact('Operate the accessible example, then compare each behavior with an inert failure fixture and an honest verification boundary.')}</p>
      <div className="page-tools">
        <span className="badge">{exact('WCAG 2.2 engineering evidence — no conformance claim · AAA engineering target')}</span>
        <ReferenceDetails links={[
          routeSourceReference(env, 'src/demos/accessibility-page.ts'),
          { label: 'Lab source', href: sourceUrl(env, 'src/ui/accessibility-lab.tsx') },
          { label: 'Global shell source', href: sourceUrl(env, 'src/ui/document.tsx') },
          { label: 'Interface tests', href: sourceUrl(env, 'tests/interface.test.ts') },
        ]} />
      </div>
    </section>
    <section className="panel" id={scope.id('accessibility-demo')} aria-labelledby={interactionHeading}>
      <div className="lab-heading"><div><p className="eyebrow">{exact('Accessible behavior')}</p><DemoHeading level={2} id={interactionHeading}>{exact('Operate the working interaction')}</DemoHeading></div><span className="badge">{exact('Safe live example')}</span></div>
      <h3>{exact('How to run')}</h3>
      <ol className="accessibility-run-steps">
        <li>{exact('Press Tab through the sample controls and check the visible focus indicator.')}</li>
        <li>{exact('Open Sign in options, press Tab inside the dialog, then press Escape to return focus.')}</li>
        <li>{exact('Reorder the task with Move up and Move down.')}</li>
        <li>{exact('Press Run automated check to start axe and read the announced result.')}</li>
      </ol>
      <button type="button" data-run-a11y-scan="">{exact('Run automated check')}</button>
      <div className="accessibility-frame"><iframe title={exact('Accessible release workflow demonstration')} sandbox="allow-scripts allow-forms" src={`${routeUrl('platform.accessibility.lab')}?mode=accessible`} data-a11y-frame="" /></div>
    </section>
    <section className="panel" aria-labelledby={scanHeading}>
      <div className="lab-heading"><div><p className="eyebrow">{exact('axe-core / partial coverage')}</p><DemoHeading level={2} id={scanHeading}>{exact('Automated check of accessible behavior')}</DemoHeading></div><span className="badge" data-scan-state="">{exact('Waiting')}</span></div>
      <p>{exact('axe checks only the live accessible interaction above. The failure fixtures below are inert teaching material and are not represented as passing automated tests.')}</p>
      <dl className="scan-counts"><dt>{exact('Critical')}</dt><dd data-impact="critical">0</dd><dt>{exact('Serious')}</dt><dd data-impact="serious">0</dd><dt>{exact('Moderate')}</dt><dd data-impact="moderate">0</dd><dt>{exact('Minor')}</dt><dd data-impact="minor">0</dd></dl>
      <p className="subtle" data-scan-meta="" role="status" aria-live="polite">{exact('Waiting for the isolated accessible frame.')}</p><ul data-scan-rules=""><li>{exact('No scan result yet.')}</li></ul>
    </section>
    <section aria-labelledby={criteriaHeading}>
      <div className="section-head"><DemoHeading level={2} id={criteriaHeading}>{exact('Failure analysis')}</DemoHeading><span>{localization.number(12)} {exact('criteria · WCAG 2.2 + APG')}</span></div>
      <p className="lede">{exact('Each fixture is escaped code, not a live broken control. Verification combines automation with the manual checks that automation cannot perform.')}</p>
      <div className="table-wrap criterion-matrix-wrap" tabIndex={0} aria-label={exact('Accessibility behavior and failure analysis')}>
        <table className="criterion-matrix"><thead><tr><th scope="col">{exact('Criterion')}</th><th scope="col">{exact('Working behavior')}</th><th scope="col">{exact('Failure fixture')}</th><th scope="col">{exact('How we verify it')}</th></tr></thead>
          <tbody>{behaviors.map((behavior) => <tr key={behavior.criterion}>
            <th scope="row"><span>{behavior.criterion}</span><strong>{exact(behavior.name)}</strong></th>
            <td>{exact(behavior.working)}</td>
            <td><p>{exact(behavior.failure)}</p><pre><code>{behavior.fixture}</code></pre></td>
            <td>{exact(behavior.verification)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="criterion-cards" aria-label={exact('Accessibility behavior and failure analysis')}>
        {behaviors.map((behavior) => <details key={behavior.criterion} className="criterion-card">
          <summary><span>{behavior.criterion}</span><strong>{exact(behavior.name)}</strong></summary>
          <div><h3>{exact('Working behavior')}</h3><p>{exact(behavior.working)}</p><h3>{exact('Failure fixture')}</h3><p>{exact(behavior.failure)}</p><pre><code>{behavior.fixture}</code></pre><h3>{exact('How we verify it')}</h3><p>{exact(behavior.verification)}</p></div>
        </details>)}
      </div>
    </section>
  </>;
}

export function accessibilitySection(_request: Request, env: Env, options: DemoSectionOptions = {}): DemoSection {
  const localization = localizationForEnv(env);
  return createReactDemoSection(env, {
    key: 'accessibility',
    title: 'WCAG 2.2 engineering',
    defaultPresentationPath: `${routeUrl('demos.index')}#accessibility`,
    browserModule: routeUrl('operations.assets', { asset: browserAssetName('scripts.accessibility') }),
    browserMessages: Object.freeze({
      noViolations: localization.exact('No axe violations were reported in the live accessible behavior. The inert failure fixtures were not scanned.'),
      reviewFindings: localization.exact('Review findings'),
      noFindings: localization.exact('No automated findings'),
      scannedPrefix: localization.exact('Scanned the accessible behavior in'),
      scannedSuffix: localization.exact('ms. Partial automated coverage; manual verification remains required.'),
      scanning: localization.exact('Scanning'),
      loading: localization.exact('Loading the accessible behavior…'),
      unavailable: localization.exact('Unavailable'),
      unavailableDetail: localization.exact('The accessible behavior and automated scan are unavailable.'),
      ready: localization.exact('Ready to run the automated check.'),
      totalFindings: localization.exact('Automated findings:'),
    }),
    children: <AccessibilityPresentation env={env} localization={localization} />,
  }, options);
}
