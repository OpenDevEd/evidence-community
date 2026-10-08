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
COPY patches ./patches
RUN --mount=type=cache,target=/root/.npm \
	npm install --no-audit --no-fund

FROM base AS builder

# CI's Type check job already runs tsc on the same commit.
ARG SKIP_BUILD_TYPECHECK=0

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm --prefix packages/evidence-library-core run build

RUN --mount=type=cache,target=/app/.next/cache \
	SKIP_BUILD_TYPECHECK=${SKIP_BUILD_TYPECHECK} npm run build

RUN npm run publication:worker:build

FROM npm-deps-base AS prod-deps

COPY package.json package-lock.json ./
COPY patches ./patches
RUN --mount=type=cache,target=/root/.npm \
	npm install --omit=dev --no-audit --no-fund

FROM ${RUNTIME_IMAGE} AS library-runtime

# Local fonts for publication previews, including Arabic, Indic and CJK scripts.
# jemalloc replaces glibc's allocator, which keeps memory that reading PDFs has freed. An idle import worker held 17 GB.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends fontconfig fonts-noto-core fonts-noto-cjk libjemalloc2 \
	&& ln -s "$(ls /usr/lib/*-linux-gnu/libjemalloc.so.2)" /usr/local/lib/libjemalloc.so.2 \
	&& rm -rf /var/lib/apt/lists/*

# Without jemalloc's background thread: with it, setpriv aborts in the entrypoint when it changes user.
ENV LD_PRELOAD=/usr/local/lib/libjemalloc.so.2
# The loader only warns about a preload it cannot open, so the build fails here instead.
RUN node -e "process.exit(require('node:fs').readFileSync('/proc/self/maps', 'utf8').includes('libjemalloc') ? 0 : 1)"

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
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/tools ./tools
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

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

FROM worker-base AS database-provisioner

ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
	CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/health`).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node_modules/.bin/tsx", "tools/runLibraryDatabaseProvisioner.ts"]

FROM worker-base AS runtime-verifier

ENV MAINTENANCE_PORT=3001 PORT=3000

ENTRYPOINT []

EXPOSE 3000 3001

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
	CMD ["node", "-e", "const socket=require('node:net').connect({host:'127.0.0.1',port:Number(process.env.PORT??3000)});socket.setTimeout(2000);socket.once('connect',()=>{socket.end();process.exit(0)});socket.once('error',()=>process.exit(1));socket.once('timeout',()=>process.exit(1))"]

CMD ["node_modules/.bin/tsx", "tools/runLibraryRuntimeVerifier.ts"]

FROM worker-base AS volume-deleter

ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
	CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/health`).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["node_modules/.bin/tsx", "tools/runLibraryVolumeDeleter.ts"]

FROM library-runtime AS final
