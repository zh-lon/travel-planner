FROM node:20-alpine

# 国内服务器构建加速（如在海外可 build 时覆盖：--build-arg NPM_REGISTRY=https://registry.npmjs.org）
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma

WORKDIR /app
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm config set registry $NPM_REGISTRY && npm ci --no-audit --no-fund

COPY . .
ENV DATABASE_URL=file:../data/app.db
RUN npm run build

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

# 启动前同步数据库结构（data 目录来自挂载卷，首次启动自动建库）
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run start"]
