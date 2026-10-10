// Writes THIRD-PARTY-LICENSES.json: every production dependency with its licence, for the SBOM / notices shipped with a release.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const raw = JSON.parse(execSync('npx --yes license-checker-rseidelsohn --production --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const rows = Object.entries(raw)
  .filter(([name]) => !name.startsWith('insight-plan-app@'))
  .map(([name, v]) => ({ name, licenses: v.licenses, repository: v.repository ?? null }))
  .sort((a, b) => a.name.localeCompare(b.name));
writeFileSync('THIRD-PARTY-LICENSES.json', JSON.stringify(rows, null, 2));
console.log(`${rows.length} packages written to THIRD-PARTY-LICENSES.json`);
