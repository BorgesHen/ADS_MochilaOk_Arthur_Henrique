FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

RUN npm run build -- --configuration production

RUN set -eux; \
    INDEX_FILE="$(find dist -name index.html -type f | head -n 1)"; \
    echo "INDEX_FILE=$INDEX_FILE"; \
    test -n "$INDEX_FILE"; \
    SITE_DIR="$(dirname "$INDEX_FILE")"; \
    mkdir -p /site; \
    cp -R "$SITE_DIR"/. /site; \
    test -f /site/index.html; \
    ls -la /site

FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /site /srv