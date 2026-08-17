# syntax=docker/dockerfile:1.7

ARG RUNTIME_IMAGE=node:22-bookworm-slim
FROM node:22-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS npm-deps-base

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates git \
	&& git config --system url."https://github.com/".insteadOf "ssh://git@github.com/" \
	&& rm -rf /var/lib/apt/lists/*

FROM npm-deps-base AS deps

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
	npm install --no-audit --no-fund

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm --prefix packages/evidence-library-core run build

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

COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/evidence-library-entrypoint

COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/docs ./docs
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/library-config/health`).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["evidence-library-entrypoint"]
CMD ["node_modules/.bin/next", "start"]

FROM base AS worker-base

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
	&& useradd --system --uid 1001 --gid nodejs worker

COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/evidence-library-entrypoint

COPY --from=deps --chown=worker:nodejs /app/node_modules ./node_modules
COPY --chown=worker:nodejs packages ./packages
COPY --chown=worker:nodejs drizzle ./drizzle
COPY --chown=worker:nodejs src ./src
COPY --chown=worker:nodejs tools ./tools
COPY --chown=worker:nodejs drizzle.config.ts package.json tsconfig.json ./

RUN npm --prefix packages/evidence-library-core run build

ENTRYPOINT ["evidence-library-entrypoint"]

FROM worker-base AS search-indexer

ENV SEARCH_INDEX_WORKER_ID=search-indexer
ENV SEARCH_INDEX_WORKER_INSTANCE_PATH=/tmp/evidence-library-search-indexer-instance

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
	CMD ["node_modules/.bin/tsx", "tools/checkSearchIndexerHealth.ts"]

CMD ["node_modules/.bin/tsx", "tools/runSearchIndexer.ts", "--watch"]

FROM worker-base AS publication-worker

ENV PUBLICATION_WORKER_ID=publication-worker
ENV PUBLICATION_WORKER_INSTANCE_PATH=/tmp/evidence-library-publication-worker-instance

RUN npm run publication:worker:build

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
	CMD ["node", ".next/publication/health.mjs"]

CMD ["node", ".next/publication/worker.mjs", "--watch"]

FROM worker-base AS source-worker-base
FROM source-worker-base AS source-sync

ENV SOURCE_SYNC_WORKER_ID=source-sync

CMD ["node_modules/.bin/tsx", "tools/runSourceSync.ts", "--watch"]

FROM source-worker-base AS source-writeback

ENV SOURCE_WRITEBACK_WORKER_ID=source-writeback

CMD ["node_modules/.bin/tsx", "tools/runSourceWriteback.ts", "--watch"]

FROM runner AS final
