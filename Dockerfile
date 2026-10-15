# Portal image for the VPS. Built by deploy/docker-compose.yml.
#
#   runtime  the app: `node build`, production dependencies only, as `node`
#   tools    migrations and one-off scripts (tsx + pg), never serves traffic

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM deps AS tools
COPY scripts ./scripts
COPY supabase/migrations ./supabase/migrations
COPY supabase/neon-bootstrap.sql ./supabase/neon-bootstrap.sql
COPY deploy/sql ./deploy/sql
COPY src/lib/server/password.ts ./src/lib/server/password.ts
USER node
ENTRYPOINT ["npx", "tsx"]
CMD ["scripts/migrate.ts"]

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
RUN mkdir -p /data/berkas && chown node:node /data/berkas
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "build"]
