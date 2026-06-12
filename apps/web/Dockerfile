# ATLAS Web — production image (Next.js build + start).
# Build from the REPO ROOT: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS builder

ENV PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH"
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/contracts packages/contracts
COPY apps/web apps/web

# AUTH_* and API URLs are read at runtime, not baked into the build.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @atlas/web build

FROM node:22-alpine

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH"
RUN corepack enable

WORKDIR /app
COPY --from=builder /app .

USER node
WORKDIR /app/apps/web
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/ || exit 1

CMD ["pnpm", "start"]
