# ATLAS Core — production image (NestJS via tsx, same transpile path as dev:
# tsx emits no decorator metadata, and the codebase uses explicit @Inject
# everywhere, so runtime behavior matches what the test suite verifies).
# Build from the REPO ROOT: docker build -f apps/core/Dockerfile .
FROM node:22-alpine

ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH"
RUN corepack enable

WORKDIR /app

# Workspace manifests first — layer-cached unless dependencies change.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/core/package.json apps/core/

# Dev deps stay: tsx + typescript are the runtime transpiler.
RUN pnpm install --frozen-lockfile

COPY packages/contracts packages/contracts
COPY apps/core apps/core

# Non-root runtime (image hardening).
USER node
WORKDIR /app/apps/core
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["pnpm", "start"]
