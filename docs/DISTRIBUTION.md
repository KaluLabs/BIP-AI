# Distribution and installation

BIP-AI v0.2 supports two installation paths:

1. a checksummed source archive built from the exact release commit;
2. a Docker/Compose packaged runtime.

BIP-AI is **not published to npm**. The package remains `private: true`.

## Option A — source archive

The release artifact of record is a Git-derived archive plus its SHA-256 checksum.

From a release checkout:

```bash
npm run dist
```

This creates:

```text
dist/
  bip-ai-v<version>.tar.gz
  SHA256SUMS.txt
  release-manifest.json
```

A release maintainer may override the artifact version without editing `package.json`:

```bash
BIP_AI_RELEASE_VERSION=0.2.0 npm run dist
```

or:

```bash
node ./scripts/build-release-artifacts.mjs --version=0.2.0
```

### Verify a downloaded archive

On Linux:

```bash
sha256sum -c SHA256SUMS.txt
tar -xzf bip-ai-v0.2.0.tar.gz
cd bip-ai-v0.2.0
node ./src/cli.js version
node ./src/cli.js setup my-project /path/to/project
node ./src/cli.js doctor
node ./src/cli.js serve
```

Node.js 22.5 or newer is required.

BIP-AI currently has no runtime npm dependencies, but the normal source workflow may still use `npm install`/npm scripts for contributor and CI commands.

## Option B — Docker

Build the image from the exact release checkout:

```bash
docker build \
  --build-arg BIP_AI_VERSION=0.2.0 \
  --build-arg BIP_AI_REVISION="$(git rev-parse HEAD)" \
  -t bip-ai:0.2.0 .
```

Check the packaged identity:

```bash
docker run --rm bip-ai:0.2.0 version
```

The image defaults all mutable BIP-AI state to `/data`.

Create a persistent volume:

```bash
docker volume create bipai-data
```

Register a local project:

```bash
docker run --rm \
  -v bipai-data:/data \
  -v "$PWD:/workspace/project:ro" \
  bip-ai:0.2.0 setup my-project /workspace/project
```

Start the Control Room:

```bash
docker run --rm \
  --name bip-ai \
  -p 127.0.0.1:8790:8790 \
  -v bipai-data:/data \
  -v "$PWD:/workspace/project:ro" \
  bip-ai:0.2.0
```

Then open the Control Room on `http://127.0.0.1:8790`.

The host port is deliberately bound to loopback. Do not change it to a public interface unless you have added an appropriate authentication/reverse-proxy boundary.

### Health and readiness

The container has a Docker health check against:

```text
GET /api/health
```

The endpoint returns the service name, runtime version, revision when available, and Node version.

You can inspect it from a running container:

```bash
docker exec bip-ai node -e \
  "fetch('http://127.0.0.1:8790/api/health').then(r=>r.text()).then(console.log)"
```

or inspect Docker's health state:

```bash
docker inspect --format '{{.State.Health.Status}}' bip-ai
```

## Docker Compose

The repository also includes `compose.yaml`.

Set the project path if the BIP-AI checkout is not itself the project you want to capture:

```bash
export BIP_AI_PROJECT_PATH=/absolute/path/to/project
docker compose build
docker compose run --rm bip-ai setup my-project /workspace/project
docker compose up -d
```

The Compose configuration:

- binds the Control Room to host loopback only;
- persists `/data` in the `bipai-data` named volume;
- mounts the project read-only;
- runs the application filesystem read-only;
- uses a temporary filesystem for `/tmp`;
- passes provider/PAG credentials only from runtime environment variables.

## Secrets and configuration

Never put secret values into Docker build arguments.

Supply secrets at runtime:

```bash
docker run --rm \
  -e PAG_BASE_URL=http://host.docker.internal:8787 \
  -e PAG_ACTOR_TOKEN="$PAG_ACTOR_TOKEN" \
  -e BIP_AI_DRAFT_PROVIDER=openai-compatible \
  -e BIP_AI_DRAFT_BASE_URL="$BIP_AI_DRAFT_BASE_URL" \
  -e BIP_AI_DRAFT_API_KEY="$BIP_AI_DRAFT_API_KEY" \
  -e BIP_AI_DRAFT_MODEL="$BIP_AI_DRAFT_MODEL" \
  -v bipai-data:/data \
  bip-ai:0.2.0 doctor
```

Other runtime-only secret-bearing variables include `BIP_AI_GITHUB_TOKEN`.

The Docker build context excludes local `.env`, `.bipai`, SQLite files, Git history, coverage, and `dist`.

## PAG from Docker

When PAG runs on the Docker host, use a host-reachable PAG URL rather than container loopback.

The checked-in Compose file maps `host.docker.internal` to the Docker host and defaults to:

```dotenv
PAG_BASE_URL=http://host.docker.internal:8787
```

No PAG token is required for local capture, deterministic drafting, review, or the Control Room. Publishing handoff remains disabled until PAG is configured.

## Persistent state and upgrades

Treat `/data` as the durable BIP-AI state boundary.

To upgrade:

1. stop the old container;
2. retain the named volume or persistent `/data` mount;
3. verify the checksum/version of the new release;
4. build or pull the new image;
5. start the new image with the **same** `/data` volume and project mounts;
6. run `doctor`;
7. confirm `/api/health` is healthy.

Example:

```bash
docker stop bip-ai

docker build \
  --build-arg BIP_AI_VERSION=0.2.1 \
  --build-arg BIP_AI_REVISION="$(git rev-parse HEAD)" \
  -t bip-ai:0.2.1 .

docker run --rm \
  -v bipai-data:/data \
  -v "$PWD:/workspace/project:ro" \
  bip-ai:0.2.1 doctor
```

The SQLite database, publishing journal, capture cursors, and project registry remain in the persistent volume rather than the image layer.

## Release verification

Trusted CI runs:

```bash
npm run verify:distribution
```

The verification checks:

- npm publication is still disabled;
- two source archives from the same commit/version have the same SHA-256 digest;
- a clean extracted source archive can run setup/doctor/version;
- the Docker image builds;
- no local `.env` or `.bipai` state was copied into the image;
- packaged version reporting works;
- state survives a fresh container;
- the packaged server reaches healthy state;
- state survives replacing the container image with a newly built image.

## npm publication

There is no supported `npm publish` flow for v0.2.

Any future npm/package-registry publication requires a separate architecture/release decision and explicit approval.
