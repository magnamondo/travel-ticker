# =============================================================================
# STAGE 1: Dependencies (shared by all targets)
# =============================================================================
FROM node:24-alpine AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (needed for build)
RUN npm ci

# =============================================================================
# STAGE 2: Build SvelteKit app (only for server)
# =============================================================================
FROM deps AS builder

WORKDIR /app

# Copy source code
COPY . .

# Build the application
# DATABASE_URL is required by SvelteKit's build analysis but not actually used
RUN DATABASE_URL=build-placeholder npm run build

# =============================================================================
# STAGE 3: Server runtime (full app with SvelteKit)
# =============================================================================
FROM node:24-alpine AS server

WORKDIR /app

# Install ImageMagick with HEIF support for image processing (HEIC conversion, thumbnails, resizing)
RUN apk add --no-cache imagemagick libheif

# Copy only what's needed for production:
# - build/         → SvelteKit server + pre-compiled worker
# - package*.json  → for npm ci
# - drizzle/       → migration SQL files
# - drizzle.config.ts + src/lib/server/db/ + tsconfig.json → for drizzle-kit push
COPY --from=builder /app/build build/
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/drizzle drizzle/
COPY --from=builder /app/src/lib/server/db src/lib/server/db/
COPY --from=builder /app/tsconfig.json ./
# Copy utility scripts
COPY --from=builder /app/scripts scripts/

# Install production dependencies + drizzle-kit for migrations
# No tsx/esbuild needed - worker is pre-compiled in build stage
RUN npm ci --omit=dev && npm install drizzle-kit drizzle-orm

# Create separate directories for database (private) and uploads (public)
# Database is NOT in the uploads path to prevent any path traversal attacks
RUN mkdir -p /app/data/db /app/data/uploads

# Copy startup script
COPY --from=builder /app/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Expose the port the app runs on
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
# IMPORTANT: Database is in separate directory from uploads to prevent path traversal attacks
ENV DATABASE_URL=/app/data/db/database.db
ENV DATA_DIR=/app/data

# Declare volume for data persistence (database + uploads)
VOLUME ["/app/data"]

# Run both the HTTP server and video worker
CMD ["./docker-entrypoint.sh"]

# =============================================================================
# STAGE 4: Worker runtime (lightweight, uses pre-compiled worker)
# =============================================================================
FROM node:24-alpine AS worker

WORKDIR /app

# Install ffmpeg for video transcoding and ImageMagick with HEIF support for HEIC conversion
RUN apk add --no-cache ffmpeg imagemagick libheif

# Copy only what's needed:
# - Pre-compiled worker from builder
# - Package files for native deps (better-sqlite3)
COPY --from=builder /app/build/worker.mjs build/
COPY --from=builder /app/package*.json ./

# Install only production dependencies (no tsx/esbuild needed)
RUN npm ci --omit=dev

# Copy entrypoint
COPY --from=builder /app/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create data directories
RUN mkdir -p /app/data/db /app/data/uploads

# Set environment variables
ENV NODE_ENV=production
ENV DATABASE_URL=/app/data/db/database.db
ENV DATA_DIR=/app/data

# Declare volume for data persistence
VOLUME ["/app/data"]

CMD ["./docker-entrypoint.sh", "worker"]
