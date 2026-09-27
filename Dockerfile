FROM node:22.23.2-bookworm-slim

ARG BIP_AI_VERSION=0.1.0
ARG BIP_AI_REVISION=unknown

LABEL org.opencontainers.image.title="BIP-AI" \
      org.opencontainers.image.description="Evidence-first, privacy-aware building-in-public agent" \
      org.opencontainers.image.source="https://github.com/victorkay97/BIP-AI" \
      org.opencontainers.image.version="${BIP_AI_VERSION}" \
      org.opencontainers.image.revision="${BIP_AI_REVISION}" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production \
    BIP_AI_DB=/data/bip-ai.sqlite \
    BIP_AI_EVENT_DIR=/data/events \
    BIP_AI_PROJECTS=/data/projects.json \
    BIP_AI_HOST=0.0.0.0 \
    BIP_AI_PORT=8790 \
    BIP_AI_ALLOW_REMOTE=1 \
    BIP_AI_VERSION=${BIP_AI_VERSION} \
    BIP_AI_REVISION=${BIP_AI_REVISION}

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data /workspace \
    && chown -R node:node /data /workspace

COPY package.json .env.example LICENSE NOTICE ./
COPY src ./src
COPY public ./public

USER node
WORKDIR /data

VOLUME ["/data"]
EXPOSE 8790

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8790/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "/app/src/cli.js"]
CMD ["serve"]
