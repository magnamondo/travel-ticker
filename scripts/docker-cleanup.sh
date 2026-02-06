#!/bin/bash
# Docker cleanup script for Travel Ticker
# Removes unused images, containers, build cache, and optionally old app images
#
# Usage:
#   ./scripts/docker-cleanup.sh           # Safe cleanup (dangling only)
#   ./scripts/docker-cleanup.sh --all     # Aggressive cleanup (all unused)
#   ./scripts/docker-cleanup.sh --prune   # Full system prune

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

APP_IMAGE="travel-ticker"
MODE="${1:-safe}"

echo -e "${BLUE}🐳 Docker Cleanup for Travel Ticker${NC}"
echo ""

# Show current disk usage
echo "📊 Current Docker disk usage:"
docker system df 2>/dev/null || echo "   (Could not get disk usage)"
echo ""

case "$MODE" in
    --all|-a)
        echo -e "${YELLOW}⚠️  Aggressive cleanup mode${NC}"
        echo "   This will remove ALL unused images, containers, and networks."
        echo ""
        read -p "Continue? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborted."
            exit 0
        fi
        
        echo ""
        echo "🗑️  Removing stopped containers..."
        docker container prune -f
        
        echo ""
        echo "🗑️  Removing unused networks..."
        docker network prune -f
        
        echo ""
        echo "🗑️  Removing ALL unused images..."
        docker image prune -a -f
        
        echo ""
        echo "🗑️  Removing build cache..."
        docker builder prune -f
        ;;
        
    --prune|-p)
        echo -e "${RED}⚠️  FULL SYSTEM PRUNE${NC}"
        echo "   This will remove:"
        echo "   - All stopped containers"
        echo "   - All unused networks"
        echo "   - All unused images"
        echo "   - All build cache"
        echo ""
        echo -e "${YELLOW}   Note: Volumes are NOT removed (use --volumes flag manually if needed)${NC}"
        echo ""
        read -p "Continue? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborted."
            exit 0
        fi
        
        echo ""
        docker system prune -a -f
        ;;
        
    --old|-o)
        echo "🔍 Finding old $APP_IMAGE images..."
        
        # Get the current/latest image ID
        LATEST_ID=$(docker images "$APP_IMAGE:latest" -q 2>/dev/null || true)
        
        if [ -z "$LATEST_ID" ]; then
            echo "   No $APP_IMAGE:latest image found"
        else
            echo "   Latest image: $LATEST_ID"
            
            # Find and remove old images with same name but different ID
            OLD_IMAGES=$(docker images "$APP_IMAGE" --format "{{.ID}}" | grep -v "^$LATEST_ID$" || true)
            
            if [ -n "$OLD_IMAGES" ]; then
                echo ""
                echo "🗑️  Removing old $APP_IMAGE images..."
                echo "$OLD_IMAGES" | xargs -r docker rmi -f
                echo -e "   ${GREEN}✓${NC} Removed old images"
            else
                echo "   No old images to remove"
            fi
        fi
        
        echo ""
        echo "🗑️  Removing dangling images..."
        docker image prune -f
        ;;
        
    *)
        # Safe mode - only dangling/unused
        echo "🧹 Safe cleanup mode (dangling images and stopped containers only)"
        echo ""
        
        echo "🗑️  Removing stopped containers..."
        CONTAINERS=$(docker container prune -f 2>&1)
        echo "$CONTAINERS" | tail -1
        
        echo ""
        echo "🗑️  Removing dangling images..."
        IMAGES=$(docker image prune -f 2>&1)
        echo "$IMAGES" | tail -1
        
        echo ""
        echo "🗑️  Removing dangling build cache..."
        CACHE=$(docker builder prune -f 2>&1)
        echo "$CACHE" | tail -1
        ;;
esac

echo ""
echo "📊 Docker disk usage after cleanup:"
docker system df 2>/dev/null || echo "   (Could not get disk usage)"

echo ""
echo -e "${GREEN}✅ Cleanup complete!${NC}"
