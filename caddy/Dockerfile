# Build Caddy with rate limiting plugin using xcaddy
FROM caddy:2-builder AS builder

RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit \
    --with github.com/darkweak/souin/plugins/caddy \
    --with github.com/darkweak/storages/otter/caddy

# Production image
FROM caddy:2-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
