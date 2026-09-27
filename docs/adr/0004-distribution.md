# ADR 0004: Distribution and reproducible installation

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

BIP-AI v0.2 needs a supported way to run outside a developer checkout without making npm publication part of the release boundary.

The runtime now includes local SQLite state, filesystem/project capture, the Control Room, optional external drafting, and optional PAG handoff. Distribution therefore has to preserve local state across upgrades, accept secrets only at runtime, expose health/version information, and remain verifiable from a release commit.

## Decision

BIP-AI supports two complementary distribution forms.

### 1. Reproducible source archive — release artifact of record

Each release commit can produce:

- `bip-ai-v<version>.tar.gz`
- `SHA256SUMS.txt`
- `release-manifest.json`

The archive is created with `git archive` from the exact release commit. Building twice from the same commit and version must produce the same SHA-256 digest in CI.

The manifest records:

- BIP-AI version;
- Git revision;
- minimum Node.js requirement;
- artifact filename;
- SHA-256 digest;
- explicit `npmPublication: false`.

This source archive is the reproducible artifact of record because it is derived directly from Git-tracked content and does not depend on package-registry publication.

### 2. Docker image — supported packaged runtime

The repository provides a Dockerfile based on an exact Node 22 patch-level image tag.

The container:

- runs as the non-root `node` user;
- includes Git because local Git capture is a supported BIP-AI source;
- stores mutable application state under `/data`;
- exposes the Control Room on container port 8790;
- has an internal health check against `/api/health`;
- receives version/revision metadata at build time;
- receives credentials and provider/PAG configuration only at runtime;
- does not copy `.env`, `.bipai`, SQLite files, Git history, or local build output into the image.

The Compose configuration publishes the Control Room only to host loopback:

`127.0.0.1:8790:8790`

The container itself binds to `0.0.0.0` only because Docker networking requires the process to listen beyond its own loopback interface. Host exposure remains loopback-only in the supported Compose configuration.

## Persistent state

The supported container state boundary is `/data`.

The image defaults to:

- `BIP_AI_DB=/data/bip-ai.sqlite`
- `BIP_AI_EVENT_DIR=/data/events`
- `BIP_AI_PROJECTS=/data/projects.json`

A named volume or equivalent persistent mount must be retained when a container is restarted or replaced by a newer image.

Project repositories are mounted separately and should normally be read-only, for example:

`/workspace/project:ro`

BIP-AI state must not be stored inside the image layer.

## Secret handling

Secrets are runtime inputs only.

Examples:

- `PAG_ACTOR_TOKEN`
- `BIP_AI_DRAFT_API_KEY`
- `BIP_AI_GITHUB_TOKEN`

They must not be supplied through Docker build arguments, Dockerfile `ENV` values, source archives, or release manifests.

The checked-in Compose file only references runtime environment variables. It contains no secret values.

## Version and readiness

A running installation reports identity through:

- `bip-ai version`
- `GET /api/health`

Packaged builds may set:

- `BIP_AI_VERSION`
- `BIP_AI_REVISION`

When no packaged override is supplied, the CLI reports the version from `package.json`.

## CI verification

The trusted CI path must verify all of the following:

1. `package.json` remains `private: true`;
2. the source archive is reproducible for the same commit/version;
3. the archive can be extracted and initialized in a clean temporary directory;
4. the Docker image builds successfully;
5. the image contains no copied `.env` or `.bipai` state;
6. the image can report its packaged version;
7. setup state survives a fresh container using the same volume;
8. the packaged server becomes healthy;
9. the same state survives replacement by a newly built image.

## Rejected or deferred approaches

### npm publication

Rejected for v0.2.

The package remains `private: true`. Publishing to npm or another package registry requires a separate explicit decision because it changes the release and supply-chain boundary.

### `curl | sh` bootstrap installer

Rejected for now.

A remote bootstrap script adds another mutable download/execution boundary and makes version pinning and auditability easier to get wrong. The source archive and Docker paths are explicit and independently verifiable.

### Standalone executable

Deferred.

Bundling Node, SQLite behavior, Git integration, and platform-specific executable builds would add a substantial maintenance and signing burden without enough benefit for the current project stage.

### Docker as the sole artifact of record

Rejected.

Container rebuilds can vary because base-image and Debian package repositories are external inputs. Docker is a supported packaged runtime, but the commit-derived source archive plus checksum remains the reproducible release artifact of record.

## Consequences

Users can choose a transparent source installation or an isolated container runtime without requiring npm.

Release verification has a deterministic artifact/checksum path.

Local state and secrets remain outside immutable release artifacts.

Future package-registry publication, signed multi-architecture images, SBOM/provenance attestations, or standalone binaries can be added later through separate decisions without changing the current trust boundary.
