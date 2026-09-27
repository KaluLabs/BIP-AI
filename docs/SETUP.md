# First-run setup

BIP-AI can be initialized from a clean clone without configuring an external drafting provider or Personal Access Gateway (PAG).

## Requirements

- Node.js **22.5.0 or newer**
- a local project directory to register for capture

Install dependencies and run the first-run workflow:

```bash
npm install
npm run setup -- bip-ai .
npm run doctor
npm run serve
```

Running `npm run setup` with no project arguments in an interactive terminal prompts for a project ID and local project path.

The equivalent direct CLI commands are:

```bash
node ./src/cli.js setup bip-ai .
node ./src/cli.js doctor
node ./src/cli.js serve
```

## What setup does

`setup` is restartable and idempotent.

It:

- verifies the supported Node.js runtime before SQLite initialization;
- validates BIP-AI environment configuration;
- creates the local SQLite database and state directories safely;
- initializes the project registry;
- registers the supplied project if it is not already registered;
- preserves an existing matching project registration on repeated runs;
- refuses to silently rewrite a project ID that already points somewhere else;
- creates `.env` from `.env.example` when the file is missing;
- never generates, prints, or copies secret values into diagnostics.

The default drafting mode is `deterministic`, so a clean installation does not require an API key.

## Doctor

Run:

```bash
npm run doctor
```

The doctor report checks:

- Node.js version;
- environment/config validity;
- local database/event/project-registry initialization;
- project-registry readability;
- deterministic or OpenAI-compatible drafting configuration;
- whether secret-bearing settings are configured, without printing their values;
- PAG reachability through `GET /health`.

The PAG health check is read-only. It does **not** create a PAG intent, request an approval, or publish anything.

Diagnostic output reports secrets only as `configured` or `not_configured`. Error messages are scrubbed against configured token/API-key values before they are returned.

## Features that work without PAG

A fresh BIP-AI installation can use these features without PAG:

- local/manual ProjectEvent ingestion;
- local Git and configured GitHub activity capture;
- storyworthiness and privacy processing;
- deterministic drafting;
- campaign editing and version history;
- approval inbox and Control Room review;
- scheduling/planning state;
- publishing-history inspection for existing journal entries.

PAG is required only for the external X/LinkedIn handoff boundary and receipt reconciliation against PAG.

If PAG is absent or unreachable, `doctor` reports a warning rather than making the local product unusable.

## Features that work without an external drafting provider

The built-in deterministic drafting path is the default and requires no API key.

To use an OpenAI-compatible drafting provider, configure:

```dotenv
BIP_AI_DRAFT_PROVIDER=openai-compatible
BIP_AI_DRAFT_BASE_URL=https://provider.example/v1
BIP_AI_DRAFT_API_KEY=...
BIP_AI_DRAFT_MODEL=...
```

`doctor` validates that all required fields are present and that the provider URL is a valid HTTP(S) URL without embedded credentials. It does not print the API key.

## PAG configuration

The default PAG URL is:

```dotenv
PAG_BASE_URL=http://127.0.0.1:8787
```

Publishing also requires:

```dotenv
PAG_ACTOR_TOKEN=...
```

Optional connection IDs can be configured for X and LinkedIn:

```dotenv
BIP_AI_X_CONNECTION_ID=
BIP_AI_LINKEDIN_CONNECTION_ID=
```

The actor token remains an environment secret. BIP-AI does not write it into project state, the SQLite journal, or diagnostic output.

## Using .env

BIP-AI automatically loads a local `.env` file when the supported Node.js runtime provides `process.loadEnvFile`. Existing process environment values retain precedence.

`setup` only creates `.env` from the checked-in `.env.example` when `.env` does not already exist. It never overwrites an existing file.

## Non-interactive setup

For scripts, CI, or headless machines, provide both project arguments:

```bash
npm run setup -- my-project /absolute/or/relative/path
```

Providing only one of the two arguments fails with an actionable error instead of guessing.

You can also initialize local state without registering a project in a non-interactive environment:

```bash
node ./src/cli.js setup
```

Then register a project later:

```bash
node ./src/cli.js projects add my-project /path/to/project
```

or rerun setup with both project arguments.
