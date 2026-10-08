# Один Dockerfile на все приложения: общий базовый слой, ARG APP выбирает пакет (plan 3.3)
FROM node:22-slim
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
COPY apps/platform/package.json apps/platform/
COPY apps/buyer-agent/package.json apps/buyer-agent/
COPY apps/provider-agent/package.json apps/provider-agent/
COPY apps/demo-store/package.json apps/demo-store/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
ARG APP
ENV APP=${APP}
CMD ["sh", "-c", "pnpm --filter @fdtd/${APP} start"]
