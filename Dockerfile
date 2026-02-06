# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
# DATABASE_URL is required by SvelteKit's build analysis but not actually used
RUN DATABASE_URL=build-placeholder npm run build

# Production stage
FROM node:24-alpine AS runner

WORKDIR /app

# Install ffmpeg for video transcoding and ImageMagick with HEIF support for HEIC conversion
RUN apk add --no-cache ffmpeg imagemagick libheif

# Copy built application and package files from builder stage
COPY --from=builder /app/build build/
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/drizzle drizzle/

# Copy the video worker source (will be run with tsx)
COPY --from=builder /app/src/worker src/worker/
# Copy db schema for drizzle-kit migrations
COPY --from=builder /app/src/lib/server/db src/lib/server/db/
COPY --from=builder /app/tsconfig.json ./

# Install production dependencies plus tools needed for runtime
# - tsx: for running the video worker TypeScript
# - drizzle-kit + drizzle-orm: for database migrations
RUN npm ci --omit=dev && npm install tsx drizzle-kit drizzle-orm

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
