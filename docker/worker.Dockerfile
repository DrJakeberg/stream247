FROM public.ecr.aws/docker/library/node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile=false

FROM public.ecr.aws/docker/library/node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter core build && pnpm --filter db build && pnpm --filter worker build

FROM public.ecr.aws/docker/library/node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache chromium ffmpeg yt-dlp python3 ttf-dejavu tini
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker ./apps/worker
COPY --from=builder /app/packages/core ./packages/core
COPY --from=builder /app/packages/db ./packages/db
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/worker/dist/index.js", "worker"]
