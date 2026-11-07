FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PREVIEW_WORKER_SOCKET=/run/atlas-preview/worker.sock

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    fonts-noto-core \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /run/atlas-preview \
  && chown node:node /run/atlas-preview

WORKDIR /app
COPY --chown=node:node apps/preview-worker/server.mjs apps/preview-worker/converter.mjs ./

USER node
CMD ["node", "server.mjs"]
