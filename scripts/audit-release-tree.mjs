import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout;
}

const tracked = git(['ls-files']).split('\n').filter(Boolean);
const violations = [];

const forbiddenPaths = [
  /^\.env$/,
  /^\.env\./,
  /^\.bipai(?:\/|$)/,
  /(?:^|\/)node_modules(?:\/|$)/,
  /(?:^|\/)dist(?:\/|$)/,
  /\.sqlite(?:-shm|-wal)?$/,
  /(?:^|\/)(?:id_rsa|id_ed25519)$/,
  /\.(?:pem|p12|pfx|key)$/
];

for (const path of tracked) {
  if (path === '.env.example') continue;
  if (forbiddenPaths.some((pattern) => pattern.test(path))) {
    violations.push(`forbidden tracked path: ${path}`);
  }
}

const secretPatterns = [
  { name: 'private key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub classic token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'OpenAI-style secret key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/ }
];

for (const path of tracked) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  for (const pattern of secretPatterns) {
    if (pattern.re.test(text)) {
      violations.push(`${pattern.name} shaped value found in ${path}`);
    }
  }
}

const envExample = readFileSync('.env.example', 'utf8');
for (const line of envExample.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]*(?:TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)=(.*)$/);
  if (!match) continue;
  const [, name, value] = match;
  if (value.trim() !== '') violations.push(`.env.example must leave ${name} blank`);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.private !== true) violations.push('package.json must keep private=true; npm publication is not approved');

if (violations.length) {
  console.error('Release exposure audit failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  trackedFiles: tracked.length,
  checks: [
    'no tracked private/local-state filenames',
    'no high-confidence credential-shaped values',
    '.env.example secret-bearing fields are blank',
    'package.json private=true'
  ]
}, null, 2));
