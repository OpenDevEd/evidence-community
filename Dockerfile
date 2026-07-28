# syntax=docker/dockerfile:1.7

ARG RUNTIME_IMAGE=node:22-bookworm-slim
FROM node:22-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS npm-deps-base

RUN apt-get update \
	&& apt-get install -y --no-install-recommends git \
	&& rm -rf /var/lib/apt/lists/*

FROM npm-deps-base AS deps

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
	npm install --no-audit --no-fund

FROM base AS builder

# Build args are limited to values still inlined into the client bundle.
# Coolify must pass these as build args (Service → Env vars → Available at Build).
ARG BASE_URL
ARG NEXT_PUBLIC_ACCENT_COLOR
ARG NEXT_PUBLIC_COLLECTION_COLOR
ARG NEXT_PUBLIC_COMPANY_NAME
ARG NEXT_PUBLIC_DEFAULT_THEME
ARG NEXT_PUBLIC_DOI_COLOR
ARG NEXT_PUBLIC_FORCED_THEME
ARG NEXT_PUBLIC_FUNDING_PARTNER
ARG NEXT_PUBLIC_INSTITUTIONS_NAME
ARG NEXT_PUBLIC_LINK_COLOR
ARG NEXT_PUBLIC_STYLE
ARG NEXT_PUBLIC_TERTIARY_COLOR

ENV BASE_URL=$BASE_URL \
	NEXT_PUBLIC_ACCENT_COLOR=$NEXT_PUBLIC_ACCENT_COLOR \
	NEXT_PUBLIC_COLLECTION_COLOR=$NEXT_PUBLIC_COLLECTION_COLOR \
	NEXT_PUBLIC_COMPANY_NAME=$NEXT_PUBLIC_COMPANY_NAME \
	NEXT_PUBLIC_DEFAULT_THEME=$NEXT_PUBLIC_DEFAULT_THEME \
	NEXT_PUBLIC_DOI_COLOR=$NEXT_PUBLIC_DOI_COLOR \
	NEXT_PUBLIC_FORCED_THEME=$NEXT_PUBLIC_FORCED_THEME \
	NEXT_PUBLIC_FUNDING_PARTNER=$NEXT_PUBLIC_FUNDING_PARTNER \
	NEXT_PUBLIC_INSTITUTIONS_NAME=$NEXT_PUBLIC_INSTITUTIONS_NAME \
	NEXT_PUBLIC_LINK_COLOR=$NEXT_PUBLIC_LINK_COLOR \
	NEXT_PUBLIC_STYLE=$NEXT_PUBLIC_STYLE \
	NEXT_PUBLIC_TERTIARY_COLOR=$NEXT_PUBLIC_TERTIARY_COLOR

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN --mount=type=cache,target=/app/.next/cache \
	npm run build

FROM npm-deps-base AS prod-deps

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
	npm install --omit=dev --no-audit --no-fund

FROM ${RUNTIME_IMAGE} AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
	&& useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/docs ./docs
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs

USER nextjs

EXPOSE 3000

CMD ["node_modules/.bin/next", "start"]
