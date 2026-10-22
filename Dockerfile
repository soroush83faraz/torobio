# Bazaar Companion: one container = Fastify API + built web app + a read-only SQLite file.
#
# The database is NOT part of git. Two ways to supply it (see docs/DEPLOY.md):
#   1. PRIMARY  - at runtime, as a mounted file/directory:  -v ./data:/data:ro   (DATABASE_PATH=/data/market.sqlite)
#   2. OPTIONAL - baked in at build time with the build args below (e.g. a private/public release asset).
#      A mount on /data hides a baked file, so the two never conflict: the mount wins.
#
# Build args (all optional):
#   NODE_IMAGE   Base image (default node:22-slim). Only change it where Docker Hub is blocked.
#   DATA_URL     URL of a data asset (raw market.sqlite or market.sqlite.zst). Empty => no data in the image.
#   DATA_SHA256  sha256 of the downloaded asset (of the .zst if compressed). The build fails on mismatch.
#   APP_COMMIT   Shown by /api/health as "commit" (compose passes it; default "dev").

ARG NODE_IMAGE=node:22-slim

# ---------------------------------------------------------------- 1. build web + bundle server
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
# Manifests first so the (slow) dependency layer is cached until a package.json / the lockfile changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY scripts/data/package.json scripts/data/package.json
# Only the workspaces the image needs (skips scripts/data tooling). better-sqlite3 ships prebuilt
# binaries for linux x64 / Node 22 inside the package, so --ignore-scripts skips the pointless
# node-gyp source build and no compiler toolchain is required.
RUN npm ci --ignore-scripts -w @app/server -w @app/web -w @app/core --include-workspace-root
COPY . .
# apps/web may still be a stub without a build script: tolerate that, the server then serves its
# built-in placeholder page.
RUN if node -e "process.exit(require('./apps/web/package.json').scripts?.build ? 0 : 1)"; then \
      npm run build -w @app/web; \
    else \
      echo "apps/web has no build script yet - skipping web build"; \
    fi \
    && mkdir -p apps/web/dist
# Single-file server bundle; @app/core (TypeScript source) is compiled into it by esbuild.
RUN npm run build -w @app/server

# ---------------------------------------------------------------- 2. fetch the data (optional)
FROM ${NODE_IMAGE} AS data
ARG DATA_URL=""
ARG DATA_SHA256=""
COPY docker/fetch-data.mjs /tmp/fetch-data.mjs
# Pure Node (fetch + sha256 + zstd via node:zlib): no apt/curl needed. Handles .zst or raw .sqlite.
RUN mkdir -p /out \
    && if [ -z "$DATA_URL" ]; then \
         echo "DATA_URL not set - image contains no data (supply it at runtime: -v ./data:/data:ro)"; \
       else \
         node /tmp/fetch-data.mjs "$DATA_URL" /out/market.sqlite "$DATA_SHA256"; \
       fi

# ---------------------------------------------------------------- 3. runtime
FROM ${NODE_IMAGE} AS runtime
ARG APP_COMMIT=dev
ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/data/market.sqlite \
    WEB_DIST=/app/web \
    RENDER_GIT_COMMIT=${APP_COMMIT}
WORKDIR /app
# Native addon: only the loader + the linux-x64 prebuilt binary (everything else is in the bundle).
COPY --from=build --chown=node:node /app/node_modules/better-sqlite3/package.json ./node_modules/better-sqlite3/package.json
COPY --from=build --chown=node:node /app/node_modules/better-sqlite3/lib ./node_modules/better-sqlite3/lib
COPY --from=build --chown=node:node /app/node_modules/better-sqlite3/prebuilds/linux-x64.node ./node_modules/better-sqlite3/prebuilds/linux-x64.node
COPY --from=build --chown=node:node /app/apps/server/dist/server.mjs ./server.mjs
COPY --from=build --chown=node:node /app/apps/web/dist ./web
# /data: empty unless DATA_URL was given. Declared a VOLUME after the copy, so a baked file seeds an
# anonymous volume while a bind mount (-v ./data:/data:ro) simply replaces it. Read-only mounts work:
# the database is opened readonly + query_only and nothing is ever written next to it.
COPY --from=data --chown=node:node /out /data
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
