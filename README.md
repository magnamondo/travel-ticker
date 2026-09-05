# Travel Ticker

A travel journal and timeline application. Document your journeys with photos, videos, and stories in a visually appealing timeline interface.

## Features

### Tickers
- Multiple independent timelines ("tickers"), each with its own name, route labels, cover image and URL
- Index page at `/` lists every published ticker with entry counts, last-updated date and preview thumbnails
- Each ticker lives at `/t/<slug>`, its entries at `/t/<slug>/entry/<id>`
- Tickers can be kept as drafts - visible to admins only, hidden from the index, the timeline and the API
- Content hierarchy: ticker -> segment -> entry

### Public Timeline
- Vertical timeline with entries grouped by segment
- Segments organize content by theme with custom emoji icons
- Entry detail pages with full comments section
- Rich media galleries with lightbox viewer
- Milestone metadata: GPS coordinates (with maps link), external links, custom icons
- Mobile swipe gestures to reveal metadata
- Infinite scroll pagination
- Emoji reactions and comments from registered users

### Media Processing
- **Images**: JPEG, PNG, GIF, WebP, HEIC/HEIF support
- **Videos**: Auto-transcoding to H.264 MP4 (max 1080p)
- **Automatic optimization**: Large images resized to 2048px, thumbnails generated at 600px
- **HEIC conversion**: Apple HEIC/HEIF photos automatically converted to JPEG
- **Chunked uploads**: Resumable uploads for large files (up to 500MB)

### Admin Dashboard
- Create and manage tickers (name, slug, route labels, cover image, publish state)
- Create and manage timeline entries (milestones)
- Organize content into segments, scoped to one ticker at a time
- Drag-and-drop reordering for segments, entries, and media
- Publish/unpublish entries (draft mode)
- User management with role-based permissions
- Video processing job queue monitoring

### Authentication
- Email-based registration with verification
- Role hierarchy: Admin > Writer > Reactor > Reader
- First user matching `ADMIN_EMAIL` gets admin role automatically
- Secure session management (30-day sessions)
- Password reset via email

## Quick Start

### Prerequisites
- Node.js 24+
- ffmpeg (for video processing)
- ImageMagick with libheif (for HEIC conversion)

### Development

```bash
# Install dependencies
npm install

# Initialize database
npm run db:push

# Start development server
npm run dev

# In another terminal, start the video worker
npm run worker
```

The app runs at http://localhost:5173

> **Note**: Without `RESEND_API_KEY`, emails are logged to the console instead of being sent.

### Production with Docker

```bash
# Build and start
docker compose up -d

# View logs
docker compose logs -f
```

See `docker-compose.yml` for the full configuration with healthchecks, resource limits, and logging.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | SQLite database path | `data/db/database.db` |
| `DATA_DIR` | Directory for uploads and database | `data` |
| `ORIGIN` | Application URL (required for CSRF in production) | `http://localhost:3000` |
| `PORT` | HTTP server port | `3000` |
| `NODE_ENV` | Environment (`development` or `production`) | - |
| `RESEND_API_KEY` | Resend API key for emails (optional, logs to console if not set) | - |
| `ADMIN_EMAIL` | Email to auto-assign admin role on first registration | - |

## Maintenance

### Cleaning Up Orphaned Files

If disk space isn't freed after deleting entries, run the cleanup script to remove orphaned files:

```bash
# Preview what would be deleted
npx tsx scripts/cleanup-orphaned-files.ts --dry-run

# Actually delete orphaned files
npx tsx scripts/cleanup-orphaned-files.ts

# Docker
docker compose exec travel-ticker npx tsx scripts/cleanup-orphaned-files.ts
```

### Regenerating Thumbnails

If you change the thumbnail size or need to regenerate all thumbnails:

```bash
# Docker
docker exec travel-ticker npx tsx scripts/regenerate-thumbnails.ts

# Docker Compose
docker compose exec travel-ticker npx tsx scripts/regenerate-thumbnails.ts

# Local development
npx tsx scripts/regenerate-thumbnails.ts
```

### Database Migrations

Migrations run automatically on container startup. For manual control:

```bash
# Generate migration from schema changes
npm run db:generate

# Apply migrations
npm run db:push
```

### Backups

The Docker volume contains both the database and uploaded files:

```bash
# Backup
docker run --rm \
  -v travel-ticker-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/travel-ticker-backup-$(date +%Y%m%d).tar.gz /data

# Restore
docker run --rm \
  -v travel-ticker-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/travel-ticker-backup-YYYYMMDD.tar.gz -C /
```

## Architecture

### Tech Stack
- **Frontend**: Svelte 5, SvelteKit
- **Backend**: Node.js with SvelteKit adapter-node
- **Database**: SQLite with Drizzle ORM
- **Video**: ffmpeg for transcoding and thumbnails
- **Images**: ImageMagick with libheif for HEIC support

### Project Structure

```
src/
├── routes/
│   ├── (app)/          # Profile pages
│   ├── (ticker)/       # Ticker index (/) and timelines (/t/<slug>)
│   ├── (admin)/        # Admin dashboard
│   ├── (auth)/         # Login, register, verify
│   └── api/            # REST endpoints
├── lib/
│   ├── server/
│   │   ├── db/         # Drizzle schema
│   │   ├── tickers.ts  # Ticker lookup, slugs, visibility
│   │   ├── image.ts    # Image processing
│   │   ├── video.ts    # Video job queue
│   │   └── auth.ts     # Authentication
│   └── components/     # Svelte components
└── worker/
    └── video-worker.ts # Background video processing
```

### Video Processing

Videos are processed by a background worker:
1. Extract thumbnail at 1 second
2. Check if transcoding needed (non-MP4/WebM formats)
3. Transcode to H.264 MP4 if needed (max 1080p)
4. Update database with final URLs

The worker automatically retries failed jobs (up to 3 times) before moving them to a dead-letter queue.

### Upload System

Large files use chunked uploads:
- 256KB chunks by default
- SHA-256 checksum verification
- Resumable via localStorage persistence
- 24-hour session expiry

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/milestones?ticker=<slug>` | Paginated milestones for one ticker (`ticker` is required) |
| `GET /api/video-status/[jobId]` | Video transcoding status |
| `POST /api/reactions` | Toggle emoji reaction |
| `POST /api/upload` | Initialize chunked upload |
| `POST /api/upload/chunk` | Upload chunk |
| `PUT /api/upload/chunk` | Complete upload |

## Security

- Argon2 password hashing
- Session tokens with SHA-256 hashing
- CSRF protection via SvelteKit
- Content Security Policy headers
- Path traversal prevention (uploads separate from database)
- Role-based access control

## License

MIT
