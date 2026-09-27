import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

const version = argument('version') || process.env.BIP_AI_RELEASE_VERSION || pkg.version;
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
  throw new Error('release version may contain only letters, numbers, dot, underscore, and hyphen');
}

const revisionResult = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8'
});
if (revisionResult.status !== 0) {
  throw new Error(revisionResult.stderr || 'unable to resolve git revision');
}
const revision = revisionResult.stdout.trim();

const distDir = join(root, 'dist');
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const artifactName = `bip-ai-v${version}.tar.gz`;
const artifactPath = join(distDir, artifactName);
const prefix = `bip-ai-v${version}/`;

const archive = spawnSync('git', [
  'archive',
  '--format=tar.gz',
  `--prefix=${prefix}`,
  `--output=${artifactPath}`,
  'HEAD'
], {
  cwd: root,
  encoding: 'utf8'
});
if (archive.status !== 0) {
  throw new Error(archive.stderr || 'git archive failed');
}

const bytes = readFileSync(artifactPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');

writeFileSync(join(distDir, 'SHA256SUMS.txt'), `${sha256}  ${artifactName}\n`);
writeFileSync(
  join(distDir, 'release-manifest.json'),
  `${JSON.stringify({
    service: 'bip-ai',
    version,
    revision,
    minimumNode: pkg.engines?.node || null,
    artifact: artifactName,
    sha256,
    npmPublication: false
  }, null, 2)}\n`
);

console.log(JSON.stringify({
  artifact: artifactPath,
  sha256,
  version,
  revision
}, null, 2));
