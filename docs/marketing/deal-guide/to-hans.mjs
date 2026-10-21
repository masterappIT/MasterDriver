// Makes the Simplified copy of a marketing picture's HTML with the app's own converter
// (web/src/i18n/convert.ts), then fixes the one word it leaves Traditional. Run from the repository root:
//   node --import tsx docs/marketing/deal-guide/to-hans.mjs                  (this folder's deal guide)
//   node --import tsx docs/marketing/deal-guide/to-hans.mjs <繁體.html> <簡體.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const { toSimplified } = await import(fileURLToPath(new URL('../../../web/src/i18n/convert.ts', import.meta.url)));
const [source = here('deal-guide-zh-Hant.html'), target = here('deal-guide-zh-Hans.html')] = process.argv.slice(2);

let html = toSimplified(readFileSync(source, 'utf8'));
html = html
  .replace('lang="zh-Hant"', 'lang="zh-Hans"')
  .replace("'PingFang TC', 'PingFang HK', 'PingFang SC'", "'PingFang SC', 'PingFang TC'")
  // 著 has two readings, so the converter keeps it; here it is 留着.
  .replaceAll('留著', '留着');
writeFileSync(target, html);
