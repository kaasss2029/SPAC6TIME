#!/usr/bin/env bash
# OrbitGuard One-Click Launcher
# Starts the background auto-sync server (if not already running) and opens the website in your default browser.

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

PORT=8000

# Check if server is already running on port 8000
if ! lsof -i :$PORT >/dev/null 2>&1; then
    echo "🚀 Starting OrbitGuard auto-sync server in background..."
    python3 server.py > /dev/null 2>&1 &
    sleep 0.8
else
    echo "⚡ OrbitGuard server is already running on port $PORT."
fi

# Open in default browser (macOS / Linux compatible)
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "http://localhost:$PORT/index.html"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "http://localhost:$PORT/index.html"
else
    start "http://localhost:$PORT/index.html"
fi

echo "✅ OrbitGuard running at http://localhost:$PORT/index.html"
