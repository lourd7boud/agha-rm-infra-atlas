# ATLAS Core — production image (NestJS via tsx, same transpile path as dev:
# tsx emits no decorator metadata, and the codebase uses explicit @Inject
# everywhere, so runtime behavior matches what the test suite verifies).
# Build from the REPO ROOT: docker build -f apps/core/Dockerfile .
#
# Base: debian-slim (NOT alpine) because we need ocrmypdf + Tesseract for
# scanned-PDF OCR. Apt has battle-tested packages; Alpine's ocrmypdf builds
# have historical reliability gaps (musl + ghostscript edge cases).
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH"
RUN corepack enable

# OCR stack — ocrmypdf wraps Tesseract + Ghostscript. fra+ara are the
# languages used in Moroccan PMP DCEs (French dossier with bilingual notices).
# wget + ca-certificates are needed for the HEALTHCHECK and outbound TLS.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ocrmypdf \
    tesseract-ocr \
    tesseract-ocr-fra \
    tesseract-ocr-ara \
    ghostscript \
    poppler-utils \
    antiword \
    catdoc \
    unrtf \
    unar \
    wget \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# antiword(.doc), catdoc→xls2csv(.xls)/catppt(.ppt), unrtf(.rtf): tiny CLI
# converters for the legacy Office binaries some buyers still ship — the
# "never fail on any format" net (see dossier-binary.ts). Total ~5 MB, far
# lighter than LibreOffice, and they only run as a last resort.
# unar: unpacks RAR (v4/v5) DCE archives — older buyers ship .rar dossiers that
# fflate (ZIP-only) can't read; dossier-archive.ts normalizes RAR → ZIP.

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
