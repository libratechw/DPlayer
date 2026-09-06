import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// Distribution commits follow their source commit; pass HEAD while validating
// a freshly built but not-yet-committed distribution.
const sourceRef = process.argv[2] ?? 'HEAD^';
const sourceCommit = execFileSync('git', ['rev-parse', '--short=7', sourceRef], {
    encoding: 'utf8',
}).trim();
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const distribution = await readFile('dist/DPlayer.min.js', 'utf8');
const expectedBanner = `DPlayer v${version} ${sourceCommit}`;

assert.equal(
    distribution.includes(expectedBanner),
    true,
    `distribution banner does not contain ${expectedBanner}`,
);
