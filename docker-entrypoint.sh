#!/bin/sh
set -e

# Setup directories (shared by all roles)
mkdir -p /app/data/db /app/data/uploads

# Role selection
ROLE=${1:-server}

if [ "$ROLE" = "worker" ] || [ "$ROLE" = "video-worker" ]; then
    echo "🎬 Starting Video Worker..."
    echo "   Node version: $(node --version)"
    echo "   Database: ${DATABASE_URL:-data/db/database.db}"
    # Execute pre-compiled worker directly - handles its own signals
    # --enable-source-maps for readable stack traces in production
    exec node --enable-source-maps build/worker.mjs
elif [ "$ROLE" = "notification-worker" ]; then
    echo "📧 Starting Notification Worker..."
    echo "   Node version: $(node --version)"
    echo "   Database: ${DATABASE_URL:-data/db/database.db}"
    echo "   Origin: ${ORIGIN:-http://localhost:5173}"
    exec node --enable-source-maps build/notification-worker.mjs
else
    # Default to Server role
    echo "🚀 Starting Web Server..."
    echo "   Node version: $(node --version)"
    echo "   Database: ${DATABASE_URL:-data/db/database.db}"

    # Only run migrations in server role
    echo "📦 Running database migrations..."
    if ! npx drizzle-kit migrate; then
        echo "⚠️  Migration warning (may be OK if no changes needed)"
    fi

    echo "🌐 Starting HTTP server..."
    # Run via exec to replace shell with node process (handles signals properly)
    export NODE_OPTIONS="--max-old-space-size=4096"
    exec node scripts/server-wrapper.mjs
fi
