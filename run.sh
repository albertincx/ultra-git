#!/usr/bin/env bash
set -e

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

REPO=""
FORCE_BUILD=0

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --build|-b)
      FORCE_BUILD=1
      ;;
    --help|-h)
      echo "Usage: ./run.sh [repository_path] [--build|-b]"
      echo ""
      echo "Options:"
      echo "  repository_path   Target repository path to open (default: current directory)"
      echo "  --build, -b       Force rebuild frontend assets before launching"
      exit 0
      ;;
    *)
      if [ -z "$REPO" ]; then
        REPO="$arg"
      fi
      ;;
  esac
done

if [ -z "$REPO" ]; then
  REPO="$(pwd)"
fi

# Free up port 3737 if another instance is lingering
if lsof -ti :3737 >/dev/null 2>&1; then
  echo "Freeing port 3737 from previous instance..."
  lsof -ti :3737 | xargs kill -9 2>/dev/null || true
  sleep 0.3
fi

# Detect whether frontend assets need to be built
REBUILD_FRONTEND=0
if [ ! -d "dist" ] || [ ! -f "dist/index.html" ]; then
  REBUILD_FRONTEND=1
elif [ -n "$(find src index.html -newer dist/index.html 2>/dev/null)" ]; then
  REBUILD_FRONTEND=1
fi

if [ "$REBUILD_FRONTEND" -eq 1 ] || [ "$FORCE_BUILD" -eq 1 ]; then
  echo "Building frontend assets..."
  if [ -x "./node_modules/.bin/tsc" ] && [ -x "./node_modules/.bin/vite" ]; then
    ./node_modules/.bin/tsc && ./node_modules/.bin/vite build
  elif command -v npm >/dev/null 2>&1; then
    npm run build
  elif command -v pnpm >/dev/null 2>&1; then
    pnpm run build
  else
    npx tsc && npx vite build
  fi
fi

# Always compile macOS native binary if it doesn't exist or if main.swift is newer
if [ ! -f "macos/ultraGit" ] || [ "macos/main.swift" -nt "macos/ultraGit" ]; then
  echo "Compiling native macOS app..."
  if command -v swiftc >/dev/null 2>&1; then
    swiftc -O -target arm64-apple-macos11.0 -framework Cocoa -framework WebKit macos/main.swift -o macos/ultraGit
    chmod +x macos/ultraGit
  else
    echo "Warning: swiftc not found, cannot compile native macOS wrapper."
  fi
fi

# Assemble macOS .app bundle if needed
if [ -f "macos/ultraGit" ] && [ ! -d "macos/ultra Git.app" ]; then
  mkdir -p "macos/ultra Git.app/Contents/MacOS" "macos/ultra Git.app/Contents/Resources"
  cp macos/ultraGit "macos/ultra Git.app/Contents/MacOS/"
  if [ -f "macos/AppIcon.icns" ]; then
    cp macos/AppIcon.icns "macos/ultra Git.app/Contents/Resources/"
  fi
  if [ -f "macos/Info.plist" ]; then
    cp macos/Info.plist "macos/ultra Git.app/Contents/"
  fi
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
SERVER_READY=0
for i in {1..50}; do
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "Error: Backend server process terminated unexpectedly."
    exit 1
  fi
  if curl -s http://127.0.0.1:3737/api/repo >/dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  sleep 0.1
done

if [ "$SERVER_READY" -ne 1 ]; then
  echo "Error: Backend server did not respond on http://127.0.0.1:3737 within 5 seconds."
  exit 1
fi

if [ -x "$DIR/macos/ultraGit" ]; then
  echo "Launching native macOS window..."
  "$DIR/macos/ultraGit" "http://127.0.0.1:3737"
elif [ -d "$DIR/macos/ultra Git.app" ]; then
  echo "Launching native macOS App bundle..."
  open -W "$DIR/macos/ultra Git.app" --args "http://127.0.0.1:3737"
else
  echo "Opening browser at http://127.0.0.1:3737..."
  open "http://127.0.0.1:3737"
  wait $SERVER_PID
fi
