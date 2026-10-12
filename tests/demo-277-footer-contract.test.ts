import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const documentSource = readFileSync('src/ui/document.tsx', 'utf8');
const homeSource = readFileSync('src/ui/home.tsx', 'utf8');
const versionProofSource = readFileSync('src/ui/version-proof.ts', 'utf8');
const stylesSource = readFileSync('src/styles/shell.css', 'utf8');

describe('DEMO-277 site footer contract', () => {
  it('links the repository security policy', () => {
    expect(documentSource).toContain('<a href={`${repositoryUrl}/security/policy`}>');
  });

  it('renders version and commit proof through the shared versionProof projection', () => {
    expect(documentSource).toContain("import { versionProof } from './version-proof';");
    expect(homeSource).toContain("import { versionProof } from './version-proof';");
    expect(documentSource).toContain('const version = versionProof(env);');
    expect(homeSource).toContain('return { state, version: versionProof(env) };');
    expect(documentSource).not.toContain('DEPLOYED_VERSION');
    expect(documentSource).not.toContain('DEPLOYED_SHA');
    expect(homeSource).not.toContain('DEPLOYED_VERSION');
    expect(homeSource).not.toContain('DEPLOYED_SHA');
    expect(versionProofSource).toContain('env.DEPLOYED_VERSION');
    expect(versionProofSource).toContain('env.DEPLOYED_SHA');
    expect(versionProofSource).toContain('Commit ${commit.slice(0, 7)}');
  });

  it('removes Route source from demo page tools while preserving shell route provenance', () => {
    expect(documentSource).not.toContain('demo.sourcePath');
    expect(documentSource).toContain("registeredRouteMetadata().find((route) => route.id === routeId)?.source.module");
    expect(documentSource).toContain("localization.t('shell.route_source', 'Route source')");
  });

  it('uses two intentional footer groups with meaningful space-between layout', () => {
    expect(documentSource).toContain('<span className="site-footer-links">');
    expect(documentSource).toContain('<span className="site-footer-build">');
    const footerRule = stylesSource.match(/^\.site-footer \{([^}]*)\}/m)?.[1] ?? '';
    expect(footerRule).toContain('display: flex');
    expect(footerRule).toContain('justify-content: space-between');
    expect(footerRule).not.toContain('flex-wrap');
    expect(stylesSource).not.toContain('.site-footer { flex-direction: column; }');
  });
});
