#!/bin/sh
set -e

echo "🚀 Starting Travel Ticker..."
echo "   Node version: $(node --version)"
echo "   Database: ${DATABASE_URL:-data/db/database.db}"

# Ensure data directories exist (db separate from uploads for security)
mkdir -p /app/data/db /app/data/uploads

# Run database migrations
echo "📦 Running database migrations..."
if ! npx drizzle-kit push --force; then
    echo "⚠️  Migration warning (may be OK if no changes needed)"
fi

# Health check function
check_process() {
    kill -0 "$1" 2>/dev/null
}

# Start the video worker in the background
echo "🎬 Starting video worker..."
npx tsx src/worker/video-worker.ts &
WORKER_PID=$!

# Give worker a moment to start
sleep 1
if ! check_process $WORKER_PID; then
    echo "❌ Video worker failed to start"
    exit 1
fi
echo "   Worker PID: $WORKER_PID"

# Start the HTTP server
echo "🌐 Starting HTTP server on port ${PORT:-3000}..."
node build &
SERVER_PID=$!

# Give server a moment to start
sleep 2
if ! check_process $SERVER_PID; then
    echo "❌ HTTP server failed to start"
    kill $WORKER_PID 2>/dev/null || true
    exit 1
fi
echo "   Server PID: $SERVER_PID"

echo ""
echo "✅ All processes started successfully"
echo ""

# Handle shutdown
shutdown() {
    echo ""
    echo "⏹️  Shutting down..."
    
    # Send SIGTERM first for graceful shutdown
    kill -TERM $WORKER_PID 2>/dev/null || true
    kill -TERM $SERVER_PID 2>/dev/null || true
    
    # Wait a bit for graceful shutdown
    sleep 2
    
    # Force kill if still running
    kill -9 $WORKER_PID 2>/dev/null || true
    kill -9 $SERVER_PID 2>/dev/null || true
    
    echo "👋 Shutdown complete"
    exit 0
}

trap shutdown SIGINT SIGTERM

# Monitor both processes
# If either dies, restart it (with backoff) or exit
WORKER_FAILURES=0
SERVER_FAILURES=0
MAX_FAILURES=5

while true; do
    sleep 5
    
    # Check worker
    if ! check_process $WORKER_PID; then
        WORKER_FAILURES=$((WORKER_FAILURES + 1))
        echo "⚠️  Video worker died (failure $WORKER_FAILURES/$MAX_FAILURES)"
        
        if [ $WORKER_FAILURES -ge $MAX_FAILURES ]; then
            echo "❌ Worker exceeded max failures, exiting"
            shutdown
        fi
        
        echo "🔄 Restarting video worker..."
        sleep $((WORKER_FAILURES * 2))  # Exponential backoff
        npx tsx src/worker/video-worker.ts &
        WORKER_PID=$!
        echo "   New worker PID: $WORKER_PID"
    else
        WORKER_FAILURES=0  # Reset on success
    fi
    
    # Check server
    if ! check_process $SERVER_PID; then
        SERVER_FAILURES=$((SERVER_FAILURES + 1))
        echo "⚠️  HTTP server died (failure $SERVER_FAILURES/$MAX_FAILURES)"
        
        if [ $SERVER_FAILURES -ge $MAX_FAILURES ]; then
            echo "❌ Server exceeded max failures, exiting"
            shutdown
        fi
        
        echo "🔄 Restarting HTTP server..."
        sleep $((SERVER_FAILURES * 2))  # Exponential backoff
        node build &
        SERVER_PID=$!
        echo "   New server PID: $SERVER_PID"
    else
        SERVER_FAILURES=0  # Reset on success
    fi
done
