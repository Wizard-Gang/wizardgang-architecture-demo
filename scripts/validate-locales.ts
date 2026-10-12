import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync('config/i18n.json', 'utf8'));
const failures: string[] = [];
const resources = new Map<string, Record<string, unknown>>();

for (const locale of config.supportedLocales) {
  const path = `src/i18n/locales/${locale}.json`;
  if (!fs.existsSync(path)) {
    failures.push(`missing locale resource: ${path}`);
    continue;
  }
  resources.set(locale, JSON.parse(fs.readFileSync(path, 'utf8')));
}

const fallback = resources.get(config.fallbackLocale);
if (!fallback) failures.push(`fallback locale is unavailable: ${config.fallbackLocale}`);
else {
  const expected = Object.keys(fallback).sort();
  for (const [locale, messages] of resources) {
    const actual = Object.keys(messages).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${locale} keys differ from ${config.fallbackLocale}`);
    for (const [key, value] of Object.entries(messages)) if (typeof value !== 'string' || !value.trim()) failures.push(`${locale}.${key} must be a non-empty string`);
  }
}

const presentationPath = 'src/i18n/presentation.json';
if (!fs.existsSync(presentationPath)) failures.push(`missing presentation resource: ${presentationPath}`);
else {
  const presentation = JSON.parse(fs.readFileSync(presentationPath, 'utf8'));
  const expectedLocales = [...config.supportedLocales].sort();
  const allowedNamespaces = new Set(['common', 'nav', 'home', 'platform', 'interfaces', 'operations', 'errors', 'client', 'summary', 'meta', 'demos']);
  for (const [key, translations] of Object.entries(presentation)) {
    const namespace = key.split('.')[0];
    if (!allowedNamespaces.has(namespace)) failures.push(`presentation key has unsupported namespace: ${key}`);
    if (!translations || typeof translations !== 'object' || Array.isArray(translations)) {
      failures.push(`presentation.${key} must contain locale translations`);
      continue;
    }
    const actualLocales = Object.keys(translations).sort();
    if (JSON.stringify(actualLocales) !== JSON.stringify(expectedLocales)) failures.push(`presentation.${key} locale coverage differs from configured locales`);
    for (const locale of expectedLocales) {
      const value = translations[locale];
      if (typeof value !== 'string' || !value.trim()) failures.push(`presentation.${key}.${locale} must be a non-empty string`);
      else if (typeof translations.en === 'string') {
        const placeholders = (text: string) => [...text.matchAll(/\{[a-zA-Z0-9_.-]+\}/g)].map(([token]) => token).sort();
        if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(translations.en))) {
          failures.push(`presentation.${key}.${locale} placeholders differ from English`);
        }
      }
    }
  }
}

for (const locale of config.rtlLocales) if (!config.supportedLocales.includes(locale)) failures.push(`RTL locale is not supported: ${locale}`);

if (failures.length) {
  console.error('Localization validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Localization validation passed: ${resources.size} locale cores with ${Object.keys(fallback).length} synchronized keys plus the complete sitewide presentation catalog.`);
