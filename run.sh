#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO="${1:-$(pwd)}"

cd "$DIR"

# Build frontend if dist doesn't exist
if [ ! -d "dist" ]; then
  echo "Building frontend..."
  pnpm run build
fi

# Compile macOS native app if binary doesn't exist
if [ ! -f "macos/ultraGit" ]; then
  echo "Compiling native macOS window..."
  swiftc -O macos/main.swift -o macos/ultraGit
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
