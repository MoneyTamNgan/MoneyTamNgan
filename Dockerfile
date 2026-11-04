# syntax=docker/dockerfile:1
#
# Next.js web app (frontend + /api/* route handlers). The scraper and
# background worker run from Dockerfile.worker instead — they need
# Chromium/Poppler/Tesseract that this image doesn't.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# This app never launches a browser; skip Puppeteer's ~300MB Chromium download.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `next build` evaluates the API route modules, which throw at import time if
# MONGODB_URI/JWT_SECRET are unset — no real connection is opened at build
# time, so placeholders are enough. Override at `docker build --build-arg ...`
# if a real NEXT_PUBLIC_REDIRECT_URI is needed baked into the client bundle.
ARG MONGODB_URI=mongodb://localhost:27017/build-placeholder
ARG JWT_SECRET=build-time-placeholder
ARG NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
ENV MONGODB_URI=$MONGODB_URI \
    JWT_SECRET=$JWT_SECRET \
    NEXT_PUBLIC_REDIRECT_URI=$NEXT_PUBLIC_REDIRECT_URI
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --chown=node:node package.json next.config.js proxy.js ./
# No public/ directory exists yet; add a COPY line here if one is introduced.
# /app/storage is where compose mounts the TOR volume. Creating it here, owned
# by the unprivileged user, makes a fresh named volume inherit that ownership.
RUN mkdir -p /app/storage && chown node:node /app/storage
# Run as the unprivileged user that ships with the node image, not root
# (Semgrep dockerfile.security.missing-user).
USER node
EXPOSE 3000
CMD ["npm", "start"]
