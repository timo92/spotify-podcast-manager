// Prints a Markdown table of the coverage per package, read from the
// json-summary report each package writes with `pnpm test:coverage`.
// CI appends it to the job summary.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const METRICS = ['lines', 'statements', 'branches', 'functions'];
const packagesDir = join(import.meta.dirname, '..', 'packages');

const rows = readdirSync(packagesDir)
  .map((name) => ({ name, file: join(packagesDir, name, 'coverage', 'coverage-summary.json') }))
  .filter(({ file }) => existsSync(file))
  .map(({ name, file }) => {
    const { total } = JSON.parse(readFileSync(file, 'utf8'));
    return `| ${name} | ${METRICS.map((m) => `${total[m].pct.toFixed(1)} %`).join(' | ')} |`;
  });

console.log('### Test coverage\n');
console.log(`| Package | ${METRICS.map((m) => m[0].toUpperCase() + m.slice(1)).join(' | ')} |`);
console.log(`| --- | ${METRICS.map(() => '---:').join(' | ')} |`);
console.log(rows.length ? rows.join('\n') : '| (no coverage reports found) | | | | |');
