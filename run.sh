#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO="${1:-$(pwd)}"

cd "$DIR"

# Free up port 3737 if another instance is lingering
if lsof -ti :3737 >/dev/null 2>&1; then
  echo "Freeing port 3737 from previous instance..."
  lsof -ti :3737 | xargs kill -9 2>/dev/null || true
  sleep 0.2
fi

# Always build frontend if dist doesn't exist or if any source files are newer than dist/index.html
REBUILD_FRONTEND=0
if [ ! -d "dist" ] || [ ! -f "dist/index.html" ]; then
  REBUILD_FRONTEND=1
elif [ -n "$(find src index.html -newer dist/index.html 2>/dev/null)" ]; then
  REBUILD_FRONTEND=1
fi

if [ "$REBUILD_FRONTEND" -eq 1 ] || [ "$1" == "--build" ] || [ "$1" == "-b" ]; then
  echo "Source changes detected, building frontend..."
  pnpm run build
fi

# Always compile macOS native binary if it doesn't exist or if main.swift is newer
if [ ! -f "macos/ultraGit" ] || [ "macos/main.swift" -nt "macos/ultraGit" ]; then
  echo "Compiling native macOS app..."
  swiftc -O -target arm64-apple-macos11.0 -framework Cocoa -framework WebKit macos/main.swift -o macos/ultraGit
fi

echo "Starting ultra Git backend for repository: $REPO..."
node server/index.js "$REPO" &
SERVER_PID=$!

cleanup() {
  echo "Terminating backend (PID $SERVER_PID)..."
  kill $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Wait for server to become responsive
for i in {1..30}; do
  if curl -s http://127.0.0.1:3737/api/repo >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

echo "Launching native macOS single window..."
"$DIR/macos/ultraGit" "http://127.0.0.1:3737"
