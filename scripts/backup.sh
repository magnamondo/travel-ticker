#!/bin/bash
# Backup script for Travel Ticker
# Creates timestamped backups of the SQLite database and uploads
#
# Usage:
#   ./scripts/backup.sh                    # Backup to default location
#   ./scripts/backup.sh /path/to/backups   # Backup to custom location
#
# For Docker deployments:
#   docker exec travel-ticker ./scripts/backup.sh
#   # Or from host:
#   docker run --rm -v travel-ticker-data:/data -v $(pwd)/backups:/backups alpine \
#     sh -c "tar czf /backups/travel-ticker-$(date +%Y%m%d-%H%M%S).tar.gz /data"

set -e

# Configuration
BACKUP_DIR="${1:-./backups}"
DATA_DIR="${DATA_DIR:-./data}"
DB_PATH="${DATABASE_URL:-$DATA_DIR/db/database.db}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="travel-ticker-$TIMESTAMP"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}📦 Travel Ticker Backup${NC}"
echo "   Timestamp: $TIMESTAMP"
echo "   Data dir:  $DATA_DIR"
echo "   Backup to: $BACKUP_DIR"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}❌ Database not found at $DB_PATH${NC}"
    exit 1
fi

# Create temporary directory for backup
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo ""
echo "🔒 Creating database backup (with SQLite .backup for consistency)..."

# Use SQLite's .backup command for a consistent snapshot
# This is safer than cp as it handles write-ahead log properly
if command -v sqlite3 &> /dev/null; then
    sqlite3 "$DB_PATH" ".backup '$TEMP_DIR/database.db'"
    echo -e "   ${GREEN}✓${NC} Database snapshot created"
else
    # Fallback: copy database file (less safe if writes are occurring)
    echo -e "   ${YELLOW}⚠ sqlite3 not found, using file copy (may be inconsistent if DB is being written)${NC}"
    cp "$DB_PATH" "$TEMP_DIR/database.db"
    # Also copy WAL and SHM files if they exist
    [ -f "$DB_PATH-wal" ] && cp "$DB_PATH-wal" "$TEMP_DIR/database.db-wal"
    [ -f "$DB_PATH-shm" ] && cp "$DB_PATH-shm" "$TEMP_DIR/database.db-shm"
fi

echo "📁 Copying uploads..."
UPLOADS_DIR="$DATA_DIR/uploads"
if [ -d "$UPLOADS_DIR" ]; then
    # Exclude chunks directory (temporary upload data)
    mkdir -p "$TEMP_DIR/uploads"
    rsync -a --exclude='chunks' "$UPLOADS_DIR/" "$TEMP_DIR/uploads/" 2>/dev/null || \
        cp -r "$UPLOADS_DIR"/* "$TEMP_DIR/uploads/" 2>/dev/null || true
    UPLOAD_COUNT=$(find "$TEMP_DIR/uploads" -type f 2>/dev/null | wc -l | tr -d ' ')
    echo -e "   ${GREEN}✓${NC} $UPLOAD_COUNT files copied"
else
    echo -e "   ${YELLOW}⚠${NC} No uploads directory found"
fi

echo "🗜️  Compressing backup..."
BACKUP_FILE="$BACKUP_DIR/$BACKUP_NAME.tar.gz"
tar -czf "$BACKUP_FILE" -C "$TEMP_DIR" .
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo -e "   ${GREEN}✓${NC} Created $BACKUP_FILE ($BACKUP_SIZE)"

# Create a "latest" symlink for easy access
ln -sf "$BACKUP_NAME.tar.gz" "$BACKUP_DIR/latest.tar.gz"

# Cleanup old backups
if [ "$RETENTION_DAYS" -gt 0 ]; then
    echo ""
    echo "🧹 Cleaning backups older than $RETENTION_DAYS days..."
    OLD_COUNT=$(find "$BACKUP_DIR" -name "travel-ticker-*.tar.gz" -mtime +"$RETENTION_DAYS" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$OLD_COUNT" -gt 0 ]; then
        find "$BACKUP_DIR" -name "travel-ticker-*.tar.gz" -mtime +"$RETENTION_DAYS" -delete
        echo -e "   ${GREEN}✓${NC} Removed $OLD_COUNT old backup(s)"
    else
        echo "   No old backups to remove"
    fi
fi

echo ""
echo -e "${GREEN}✅ Backup complete!${NC}"
echo ""
echo "To restore:"
echo "  1. Stop the application"
echo "  2. Extract: tar -xzf $BACKUP_FILE -C $DATA_DIR"
echo "  3. Start the application"
