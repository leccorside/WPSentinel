# syntax=docker/dockerfile:1
# WP Sentinel: painel web + motor (monitor e limpeza). Imagem Linux, igual no PC (Docker Desktop) e numa VPS
# (linux/amd64 ou linux/arm64).

# 1) Front-end React compilado para arquivos estáticos.
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2) Dependências de produção do servidor e do motor.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 3) Imagem final.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    PANEL_LISTEN=0.0.0.0
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY server ./server
COPY --from=web /web/dist ./web/dist
# .env, .monitor-data e reports chegam por volume (docker-compose.yml); as pastas existem para o caso de rodar sem volume.
RUN mkdir -p .monitor-data reports && chown -R node:node /app
USER node
EXPOSE 8787
CMD ["node", "server/index.mjs"]
