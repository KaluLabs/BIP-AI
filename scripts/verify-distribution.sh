#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SHORT_SHA="${GITHUB_SHA:-local}"
SHORT_SHA="${SHORT_SHA:0:12}"
IMAGE="bip-ai:ci-${SHORT_SHA}"
UPGRADE_IMAGE="bip-ai:ci-upgrade-${SHORT_SHA}"
VOLUME="bip-ai-ci-state-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
CONTAINER="bip-ai-ci-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
TMP_ROOT="$(mktemp -d)"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
  docker image rm -f "$IMAGE" "$UPGRADE_IMAGE" >/dev/null 2>&1 || true
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

echo "Verifying npm publication remains disabled..."
node -e "const p=require('./package.json'); if(p.private!==true){throw new Error('package.json private must remain true')}"

echo "Verifying reproducible source archive..."
node ./scripts/build-release-artifacts.mjs --version=ci >/dev/null
FIRST_SHA="$(awk '{print $1}' dist/SHA256SUMS.txt)"
cp dist/SHA256SUMS.txt "$TMP_ROOT/first-sha.txt"
rm -rf dist
node ./scripts/build-release-artifacts.mjs --version=ci >/dev/null
SECOND_SHA="$(awk '{print $1}' dist/SHA256SUMS.txt)"
test "$FIRST_SHA" = "$SECOND_SHA"

mkdir -p "$TMP_ROOT/source"
tar -xzf dist/bip-ai-vci.tar.gz -C "$TMP_ROOT/source"
SOURCE_DIR="$TMP_ROOT/source/bip-ai-vci"
mkdir -p "$TMP_ROOT/source-state"
(
  cd "$SOURCE_DIR"
  BIP_AI_DB="$TMP_ROOT/source-state/bip-ai.sqlite" \
  BIP_AI_EVENT_DIR="$TMP_ROOT/source-state/events" \
  BIP_AI_PROJECTS="$TMP_ROOT/source-state/projects.json" \
    node ./src/cli.js setup >/dev/null
  BIP_AI_DB="$TMP_ROOT/source-state/bip-ai.sqlite" \
  BIP_AI_EVENT_DIR="$TMP_ROOT/source-state/events" \
  BIP_AI_PROJECTS="$TMP_ROOT/source-state/projects.json" \
    node ./src/cli.js doctor >/dev/null
  PACKAGE_VERSION="$(node -p "require('./package.json').version")"
  node ./src/cli.js version | grep -F "\"version\": \"${PACKAGE_VERSION}\"" >/dev/null
)

echo "Building packaged Docker runtime..."
docker build \
  --build-arg BIP_AI_VERSION="ci-${SHORT_SHA}" \
  --build-arg BIP_AI_REVISION="${GITHUB_SHA:-local}" \
  -t "$IMAGE" .

docker run --rm "$IMAGE" version | grep -F "ci-${SHORT_SHA}" >/dev/null
docker run --rm --entrypoint sh "$IMAGE" -c 'test ! -e /app/.env && test ! -d /app/.bipai'

docker volume create "$VOLUME" >/dev/null

echo "Initializing persistent state in one container..."
docker run --rm \
  -v "$VOLUME:/data" \
  -v "$ROOT:/workspace/project:ro" \
  "$IMAGE" setup ci-project /workspace/project >/dev/null

echo "Verifying state survives a fresh container..."
docker run --rm \
  -v "$VOLUME:/data" \
  -v "$ROOT:/workspace/project:ro" \
  "$IMAGE" projects list | grep -F '"id": "ci-project"' >/dev/null

echo "Verifying packaged health/readiness..."
docker run -d \
  --name "$CONTAINER" \
  -v "$VOLUME:/data" \
  -v "$ROOT:/workspace/project:ro" \
  "$IMAGE" >/dev/null

HEALTH=""
for _ in $(seq 1 30); do
  HEALTH="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER")"
  if [ "$HEALTH" = "healthy" ]; then
    break
  fi
  if [ "$HEALTH" = "unhealthy" ]; then
    docker logs "$CONTAINER"
    exit 1
  fi
  sleep 1
done
test "$HEALTH" = "healthy"

docker exec "$CONTAINER" node -e "fetch('http://127.0.0.1:8790/api/health').then(r=>r.json()).then(v=>{if(!v.ok||v.version!==process.env.BIP_AI_VERSION){process.exit(1)}}).catch(()=>process.exit(1))"
docker rm -f "$CONTAINER" >/dev/null

echo "Verifying state survives image replacement..."
docker build \
  --build-arg BIP_AI_VERSION="ci-upgrade-${SHORT_SHA}" \
  --build-arg BIP_AI_REVISION="${GITHUB_SHA:-local}" \
  -t "$UPGRADE_IMAGE" . >/dev/null

docker run --rm \
  -v "$VOLUME:/data" \
  -v "$ROOT:/workspace/project:ro" \
  "$UPGRADE_IMAGE" projects list | grep -F '"id": "ci-project"' >/dev/null

echo "Distribution verification passed."
