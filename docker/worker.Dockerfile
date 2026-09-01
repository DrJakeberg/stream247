FROM public.ecr.aws/docker/library/node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/render/package.json packages/render/package.json
RUN pnpm install --frozen-lockfile=false

FROM public.ecr.aws/docker/library/node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
# The whole installed tree, for the same reason as the web image: pnpm puts a node_modules in every
# workspace package, filled with symlinks into the store, and taking only the root one leaves the
# build resolving pg and @stream247/core through whatever the context happened to carry in.
#
# This was load-bearing and unnoticed. Excluding **/node_modules from the build context fixed the
# web image and broke this one in the same commit, which nothing caught: local builds still had the
# packages lying around, and the change never reached CI.
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter core build && pnpm --filter db build && pnpm --filter @stream247/overlay-render build && pnpm --filter worker build

FROM public.ecr.aws/docker/library/node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# No browser: the on-air overlay is rendered natively (satori + resvg) inside the playout process.
# ttf-dejavu supplies the overlay fonts as well as ffmpeg's drawtext fallback.
RUN apk add --no-cache ffmpeg yt-dlp python3 ttf-dejavu tini
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker ./apps/worker
COPY --from=builder /app/packages/core ./packages/core
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/packages/render ./packages/render
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/worker/dist/index.js", "worker"]
