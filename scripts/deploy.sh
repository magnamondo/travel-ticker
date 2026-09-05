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
#   --no-restart           Only sync files; skip the remote 'docker compose up -d --build'
#   --restart-only         Skip the file sync; only run the remote docker compose step
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
# Rebuild + restart the remote docker compose stack after syncing.
# Set DEPLOY_RESTART=0 (env or .deploy.env) to opt out by default.
RESTART="${DEPLOY_RESTART:-1}"
SYNC=1

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
        --no-restart)
            RESTART=0
            shift
            ;;
        --restart-only)
            SYNC=0
            RESTART=1
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
    echo "  --no-restart           Skip the remote docker compose rebuild"
    echo "  --restart-only         Skip the sync, only rebuild remotely"
    echo ""
    echo "Environment variables (or use .deploy.env file):"
    echo "  DEPLOY_TARGET    Default target (user@host:/path)"
    echo "  DEPLOY_KEY       Default SSH key file"
    echo "  DEPLOY_RESTART   Set to 0 to skip the remote rebuild by default"
    exit 1
fi

# Split target into host and remote path (needed for the remote docker step)
REMOTE_HOST="${TARGET%%:*}"
REMOTE_PATH="${TARGET#*:}"
if [ "$RESTART" = "1" ] && { [ "$REMOTE_HOST" = "$TARGET" ] || [ -z "$REMOTE_PATH" ]; }; then
    echo -e "${RED}Error: Target must be user@host:/path to run the remote rebuild${NC}"
    echo "   Got: $TARGET  (use --no-restart to sync only)"
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
[ "$SYNC" = "0" ] && echo -e "   ${YELLOW}(restart only - skipping file sync)${NC}"
[ "$RESTART" = "0" ] && echo -e "   ${YELLOW}(no restart - remote stack left untouched)${NC}"
echo ""

if [ "$SYNC" = "1" ]; then

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

if [ -z "$DRY_RUN" ]; then
    echo ""
    echo -e "${GREEN}✅ Files synced${NC}"
fi

fi  # end SYNC

# Rebuild and restart the remote stack
if [ "$RESTART" = "1" ]; then
    # .git is not deployed, so stamp the build with the local commit
    GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"

    SSH_CMD=(ssh)
    [ -n "$SSH_KEY" ] && SSH_CMD+=(-i "$SSH_KEY")

    # Runs in the deployed directory on the remote host
    REMOTE_SCRIPT="cd $(printf '%q' "$REMOTE_PATH") && GIT_SHA=$(printf '%q' "$GIT_SHA") docker compose up -d --build --remove-orphans && docker compose ps"

    echo ""
    if [ -n "$DRY_RUN" ]; then
        echo -e "${YELLOW}🐳 Would run on $REMOTE_HOST:${NC}"
        echo "   $REMOTE_SCRIPT"
    else
        echo -e "${CYAN}🐳 Rebuilding remote stack on $REMOTE_HOST...${NC}"
        if ! "${SSH_CMD[@]}" "$REMOTE_HOST" "$REMOTE_SCRIPT"; then
            echo ""
            echo -e "${RED}❌ Remote 'docker compose up -d --build' failed${NC}"
            echo "   Files were synced. Investigate with:"
            echo "     ssh $REMOTE_HOST 'cd $REMOTE_PATH && docker compose logs --tail=50'"
            exit 1
        fi
    fi
fi

echo ""
if [ -n "$DRY_RUN" ]; then
    echo -e "${YELLOW}✅ Dry run complete - nothing was changed${NC}"
    echo "   Remove --dry-run to perform actual deployment"
elif [ "$RESTART" = "1" ]; then
    echo -e "${GREEN}✅ Deployment complete - remote stack rebuilt and running!${NC}"
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
