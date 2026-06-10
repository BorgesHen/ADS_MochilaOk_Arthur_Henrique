FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

RUN npx ng build --configuration production --output-path=/tmp/mochilaok-build

RUN set -eux; \
    echo "Arquivos gerados pelo build:"; \
    find /tmp/mochilaok-build -maxdepth 5 -type f | sort; \
    INDEX_FILE="$(find /tmp/mochilaok-build -type f \( -name index.html -o -name index.csr.html \) | head -n 1)"; \
    echo "INDEX_FILE=$INDEX_FILE"; \
    test -n "$INDEX_FILE"; \
    SITE_DIR="$(dirname "$INDEX_FILE")"; \
    mkdir -p /site; \
    cp -R "$SITE_DIR"/. /site; \
    if [ ! -f /site/index.html ] && [ -f /site/index.csr.html ]; then cp /site/index.csr.html /site/index.html; fi; \
    test -f /site/index.html; \
    echo "Arquivos copiados para /site:"; \
    ls -la /site

FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /site /srv