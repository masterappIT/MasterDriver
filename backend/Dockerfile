# The API image. Build from the repository root:
#   docker build --file backend/Dockerfile .
# The same image runs the API service and the migration job (deploy/cloud-run).

FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

# Workspace manifests first, so dependencies are cached until one of them changes.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/package.json
COPY backend/package.json ./backend/package.json
COPY admin/package.json ./admin/package.json
COPY web/package.json ./web/package.json
RUN npm ci --workspace shared --workspace backend --include-workspace-root

COPY prisma ./prisma
COPY shared ./shared
COPY backend ./backend
RUN npm run build:api

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app/backend
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package-lock.json /app/
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/shared/package.json /app/shared/package.json
COPY --from=build /app/shared/dist /app/shared/dist
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/generated ./generated
COPY --from=build /app/prisma /app/prisma

USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
