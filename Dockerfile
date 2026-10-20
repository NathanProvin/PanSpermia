# The game in one image: the server (TypeScript run as is by Node 24) serving the built client on :2567.
# Built and published by CI (.github/workflows/ci.yml); run with compose.yaml (deploy/SETUP.md).
FROM node:24-slim AS build
WORKDIR /app
# Dependencies first: this layer is reused until a package.json or the lockfile changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=2567 HALL_DB=/data/hall.db
COPY --from=build /app /app
# The Hall of Fame lives on a volume, owned by the unprivileged user the server runs as.
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:2567/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/src/index.ts"]
