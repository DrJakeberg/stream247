FROM public.ecr.aws/docker/library/node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/render/package.json packages/render/package.json
RUN pnpm install --frozen-lockfile=false

FROM public.ecr.aws/docker/library/node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
# The whole installed tree, not just the root node_modules. pnpm puts a node_modules in every
# workspace package, filled with symlinks into the store, and taking only the root one left the
# build resolving next through whatever the context happened to carry in.
COPY --from=deps /app ./
COPY . .
RUN pnpm build

FROM public.ecr.aws/docker/library/node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# The studio preview is drawn by the same renderer as the broadcast, which means this image now
# needs the same fonts as the worker image — the identical package, deliberately, because the two
# pictures are only comparable if they were laid out with the same glyphs. Without it the preview
# endpoint answers 503 and the studio says so, rather than quietly drawing the wrong typeface.
RUN apk add --no-cache ttf-dejavu
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
