# Single image: server serving the built SPA statically (PLAN.md §8.5).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @tamasha/client build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
ENV PORT=8787
ENV STATIC_DIR=/app/packages/client/dist
EXPOSE 8787
CMD ["pnpm", "--filter", "@tamasha/server", "start"]
