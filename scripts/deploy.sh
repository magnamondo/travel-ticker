#!/bin/bash
# Deploy script for Travel Ticker
# Uploads project files to a remote server via SSH, respecting .gitignore
#
# Usage:
#   ./scripts/deploy.sh user@host:/path/to/destination
#   # Or use a .deploy.env file (create from .deploy.env.example):
#   ./scripts/deploy.sh
#
# Options:
#   -i, --identity FILE    Path to SSH private key file
#   --dry-run              Show what would be transferred without actually doing it
#   --delete               Remove files on remote that don't exist locally (careful!)
#
# Examples:
#   ./scripts/deploy.sh deploy@myserver.com:/var/www/travel-ticker
#   ./scripts/deploy.sh -i ~/.ssh/deploy_key user@host:/path
#   DEPLOY_TARGET=deploy@prod:/app DEPLOY_KEY=~/.ssh/id_ed25519 ./scripts/deploy.sh --dry-run

set -e

# Get project root (for finding .deploy.env)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load .deploy.env if it exists (before parsing args so args can override)
if [ -f "$PROJECT_ROOT/.deploy.env" ]; then
    # shellcheck disable=SC1091
    set -a  # auto-export all variables
    source "$PROJECT_ROOT/.deploy.env"
    set +a
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Parse arguments
DRY_RUN=""
DELETE=""
TARGET=""
SSH_KEY="${DEPLOY_KEY:-}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN="--dry-run"
            shift
            ;;
        --delete)
            DELETE="--delete"
            shift
            ;;
        -i|--identity)
            SSH_KEY="$2"
            shift 2
            ;;
        -*)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
        *)
            TARGET="$1"
            shift
            ;;
    esac
done

# Get target from argument or environment
TARGET="${TARGET:-$DEPLOY_TARGET}"

if [ -z "$TARGET" ]; then
    echo -e "${RED}Error: No deployment target specified${NC}"
    echo ""
    echo "Usage: $0 [options] user@host:/path"
    echo "   or: DEPLOY_TARGET=user@host:/path $0 [options]"
    echo ""
    echo "Options:"
    echo "  -i, --identity FILE    SSH private key file"
    echo "  --dry-run              Show what would be transferred"
    echo "  --delete               Remove remote files not in source"
    echo ""
    echo "Environment variables (or use .deploy.env file):"
    echo "  DEPLOY_TARGET    Default target (user@host:/path)"
    echo "  DEPLOY_KEY       Default SSH key file"
    exit 1
fi

# Validate SSH key if specified
if [ -n "$SSH_KEY" ]; then
    if [ ! -f "$SSH_KEY" ]; then
        echo -e "${RED}Error: SSH key file not found: $SSH_KEY${NC}"
        exit 1
    fi
fi

# Change to project root
cd "$PROJECT_ROOT"

echo -e "${CYAN}🚀 Deploying Travel Ticker${NC}"
echo "   Source: $PROJECT_ROOT"
echo "   Target: $TARGET"
[ -n "$SSH_KEY" ] && echo "   SSH Key: $SSH_KEY"
[ -n "$DRY_RUN" ] && echo -e "   ${YELLOW}(dry run - no actual changes)${NC}"
[ -n "$DELETE" ] && echo -e "   ${YELLOW}(delete mode - removing orphaned files)${NC}"
echo ""

# Build rsync exclude patterns from .gitignore
# rsync uses different syntax than .gitignore, so we need to handle some cases
EXCLUDE_FILE=$(mktemp)
trap "rm -f $EXCLUDE_FILE" EXIT

# Always exclude these
cat > "$EXCLUDE_FILE" << 'EOF'
.git/
.gitignore
.DS_Store
Thumbs.db
*.db
*.db-wal
*.db-shm
node_modules/
.svelte-kit/
build/
.output/
.vercel/
.netlify/
.wrangler/
.env
.env.*
.deploy.env
!.env.example
data/
vite.config.js.timestamp-*
vite.config.ts.timestamp-*
# Exclude the scripts themselves from deployment if you want to run deploy from local only
# scripts/
EOF

# Add any additional patterns from .gitignore that aren't already covered
if [ -f ".gitignore" ]; then
    # Process .gitignore - skip comments and empty lines, handle negations
    while IFS= read -r line || [ -n "$line" ]; do
        # Skip comments and empty lines
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line// }" ]] && continue
        # Add to exclude file if not already there
        if ! grep -Fxq "$line" "$EXCLUDE_FILE" 2>/dev/null; then
            echo "$line" >> "$EXCLUDE_FILE"
        fi
    done < .gitignore
fi

echo "📋 Excluding patterns:"
head -20 "$EXCLUDE_FILE" | sed 's/^/   /'
TOTAL_EXCLUDES=$(wc -l < "$EXCLUDE_FILE" | tr -d ' ')
[ "$TOTAL_EXCLUDES" -gt 20 ] && echo "   ... and $((TOTAL_EXCLUDES - 20)) more"
echo ""

# Run rsync
echo "📦 Syncing files..."
if [ -n "$SSH_KEY" ]; then
    rsync -avz --progress \
        -e "ssh -i $SSH_KEY" \
        --exclude-from="$EXCLUDE_FILE" \
        $DRY_RUN \
        $DELETE \
        ./ "$TARGET"
else
    rsync -avz --progress \
        --exclude-from="$EXCLUDE_FILE" \
        $DRY_RUN \
        $DELETE \
        ./ "$TARGET"
fi

echo ""
if [ -n "$DRY_RUN" ]; then
    echo -e "${YELLOW}✅ Dry run complete - no files were transferred${NC}"
    echo "   Remove --dry-run to perform actual deployment"
else
    echo -e "${GREEN}✅ Deployment complete!${NC}"
    echo ""
    echo "Next steps on the remote server:"
    echo ""
    echo "  Docker deployment (recommended):"
    echo "    docker compose up -d --build"
    echo ""
    echo "  Or for manual deployment:"
    echo "    1. npm ci"
    echo "    2. npm run build"
    echo "    3. npm run db:push"
    echo "    4. node build"
fi
