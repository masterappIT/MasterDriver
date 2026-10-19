# The API image. Build from the repository root:
#   docker build --file backend/Dockerfile .
# The same image runs the API service and the migration job (deploy/cloud-run).

FROM node:24-bookworm-slim AS build

# 數據流監控's IP-to-region database: DB-IP City Lite (CC BY 4.0, credited on the admin page),
# one release a month. The workflow passes the month; a release not out yet falls back to the month before.
ARG DBIP_RELEASE=""

WORKDIR /app
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl curl gzip \
  && rm -rf /var/lib/apt/lists/*

# Workspace manifests first, so dependencies are cached until one of them changes.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/package.json
COPY backend/package.json ./backend/package.json
COPY admin/package.json ./admin/package.json
COPY web/package.json ./web/package.json
RUN npm ci --workspace shared --workspace backend --include-workspace-root

# A release that cannot be downloaded does not stop the deployment: regions then show 未知地區.
# Time limits: a download that stalls once kept a release waiting for an hour (2026-10-19).
RUN set -u; \
  mkdir -p backend/geoip; \
  for release in "${DBIP_RELEASE:-$(date -u +%Y-%m)}" "$(date -u -d "$(date -u +%Y-%m-01) -1 month" +%Y-%m)"; do \
    if curl --fail --location --retry 3 --connect-timeout 20 --max-time 300 --retry-max-time 600 --silent --show-error "https://download.db-ip.com/free/dbip-city-lite-${release}.mmdb.gz" --output /tmp/dbip.mmdb.gz \
      && gzip -t /tmp/dbip.mmdb.gz \
      && gunzip -c /tmp/dbip.mmdb.gz > /tmp/dbip-city-lite.mmdb \
      && node -e 'require("maxmind").open("/tmp/dbip-city-lite.mmdb").then((r) => { if (r.metadata.databaseType !== "DBIP-City-Lite" || !r.get("8.8.8.8")?.country?.names?.en) process.exit(1); }).catch((e) => { console.error(e); process.exit(1); })'; then \
      mv /tmp/dbip-city-lite.mmdb backend/geoip/dbip-city-lite.mmdb; \
      echo "DB-IP City Lite ${release} included"; \
      break; \
    fi; \
    echo "DB-IP City Lite ${release} not available"; \
  done; \
  rm -f /tmp/dbip.mmdb.gz /tmp/dbip-city-lite.mmdb

COPY prisma ./prisma
COPY shared ./shared
COPY backend ./backend
RUN npm run build:api

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app/backend
# fonts-noto-cjk: the link-preview cards (src/link-preview) are drawn on the server, and their
# Chinese needs a font; without one every character comes out as a box.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl fontconfig fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package-lock.json /app/
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/shared/package.json /app/shared/package.json
COPY --from=build /app/shared/dist /app/shared/dist
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/generated ./generated
COPY --from=build /app/prisma /app/prisma
COPY --from=build /app/backend/geoip ./geoip

USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
