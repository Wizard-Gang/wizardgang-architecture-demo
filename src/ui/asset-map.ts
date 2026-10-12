import manifest from '../generated/asset-manifest.json';

export type BrowserAssetKey = keyof typeof manifest.assets;

const assetPaths = new Set<string>(Object.values(manifest.assets));

export function browserAssetPath(key: BrowserAssetKey): string {
  return manifest.assets[key];
}

export function browserAssetName(key: BrowserAssetKey): string {
  return browserAssetPath(key).replace(/^\/assets\//, '');
}

export function registeredBrowserAssetPath(asset: string): string | undefined {
  const path = `/assets/${asset}`;
  return assetPaths.has(path) ? path : undefined;
}
