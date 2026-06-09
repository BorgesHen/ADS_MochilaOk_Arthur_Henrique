FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

RUN mkdir -p /site && \
    if find dist -path "*/browser/index.html" -print -quit | grep -q .; then \
      SITE_DIR=$(dirname "$(find dist -path "*/browser/index.html" -print -quit)") && cp -r "$SITE_DIR"/* /site/; \
    else \
      SITE_DIR=$(dirname "$(find dist -name index.html -print -quit)") && cp -r "$SITE_DIR"/* /site/; \
    fi

FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /site /srv