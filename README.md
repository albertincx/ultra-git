# ⚡️ ultra Git (Mac Native)

> **Ultrafast, ultralow-memory macOS Git GUI replicating the beloved *** Version Control workflow.**  
> Built for developers who want the speed, ergonomics, and power of ultra's Git tools without launching a heavy IDE or burning 500 MB+ of RAM with Electron.

---

## 🚀 Why ultra Git?

* **⚡️ Ultrafast Launch (< 200ms):** Launches instantaneously on Apple Silicon and Intel Macs.
* **🪶 Ultralow Memory Footprint (~35 MB RAM):** Powered by native macOS **Swift (75 KB binary)** and system **WKWebView**. No heavy Chromium or Electron bloat.
* **⌨️ Live Editable Diff View:** Edit the working tree copy directly inside the diff editor. Press `Cmd+S` to save instantly to disk.
* **↩️ Per-Chunk Rollback Arrows:** Revert individual change hunks with a single click right in the line gutter.
* **📦 JetBrains Local Shelf:** Store and organize patches locally independent of `git stash`. Unshelve or delete anytime.
* **📂 Local Changes & Changelists:** Full support for `Default changelist`, custom changelists, drag/move files between changelists, and folder checkboxes in Tree View.
* **🌲 Project File Explorer:** Integrated file tree above Local Changes with instant lazy-loading and Git status colors.
* **📑 Multi-Project Tabs & Recent History:** Open multiple repositories simultaneously in tabs with a quick-access list of the last 10 opened projects.

---

## ✨ Features Breakdown

### 1. Interactive Diff & Live Editor (CodeMirror 6)
- **Side-by-Side & Unified Diff:** Compare HEAD with your local working copy.
- **In-Place Live Editing:** The right pane is a full-featured code editor. Modify your code directly inside the diff view, with syntax highlighting and automatic saving (`Cmd+S`).
- **One-Click Chunk Rollback:** Every changed hunk has an interactive rollback arrow (`↩`) in the gutter. Click it to revert just that specific change back to HEAD.
- **Auto-Scroll to First Change:** Automatically centers the view on the first difference when opening modified files.
- **Smart Untracked View:** When viewing untracked or new files, the empty left diff pane is automatically hidden, providing a clean full-width editor.
- **Difference Navigation:** Jump through changes with `F7` (Next Difference) and `Shift+F7` (Previous Difference).

### 2. Local Changes & Changelists
- **Directory Tree & Flat List:** Toggle between a hierarchical folder tree and a flat path list.
- **Folder Checkboxes:** Check or uncheck entire directories and all their sub-files with tri-state checkboxes.
- **Changelists Management:** Create custom changelists, move files between lists via context menu, and commit selected files with `Cmd+Enter`.
- **Status Indicators:** JetBrains color palette for Modified (Blue), Untracked/Added (Green), and Deleted (Grey).

### 3. Local Shelf (JetBrains Shelve)
- Shelve selected files or whole changelists into independent `.patch` files on disk with timestamps and descriptions.
- Review shelved files and their diffs.
- Unshelve changes back to your working copy (with optional *Keep in shelf* toggle).

### 4. Project Files Explorer
- Integrated folder explorer situated above Local Changes.
- Fast lazy directory loading (instant even on massive monorepos).
- Resizable horizontal splitter to adjust height between Project Files and Local Changes.

### 5. Multi-Project Tabs & Recent Projects History
- Open multiple Git repositories in tabs within a single native window.
- Fast project switcher and native macOS Finder folder picker (**Browse...**).
- Drag-and-drop any repository folder directly from Finder.
- **Recent Projects History:** Stores up to 10 recently opened projects with quick one-click reopening.

---

## 🛠️ Architecture & Tech Stack

```
┌────────────────────────────────────────────────────────┐
│               Native macOS Window                      │
│     (Swift 6 + WKWebView • 75 KB • ~35 MB RAM)         │
├────────────────────────────────────────────────────────┤
│           Vite + React 19 + TypeScript                 │
│      CodeMirror 6 (@codemirror/merge, @codemirror/view) │
├────────────────────────────────────────────────────────┤
│               Lightweight Local Backend                │
│       Native Node.js HTTP Daemon • Native Git CLI      │
└────────────────────────────────────────────────────────┘
```

---

## 🏁 Quick Start

### Prerequisites
- macOS (Apple Silicon or Intel)
- Node.js (v18+)
- pnpm (`npm install -g pnpm`)
- Xcode Command Line Tools (`xcode-select --install` for `swiftc`)

### Installation & Run

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/ultra-git.git
   cd ultra-git
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Launch the app:
   ```bash
   ./run.sh [optional/path/to/repo]
   ```
   *(If no path is provided, it opens the current directory).*

---

## 💡 Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd + S` | Save modified file in Diff Editor directly to disk |
| `Cmd + Enter` | Commit selected files (when in Commit message box) |
| `F7` | Jump to Next Difference |
| `Shift + F7` | Jump to Previous Difference |
| `F5` / Refresh button | Refresh Git status & file tree |
| `Cmd + Q` | Quit application cleanly |

---

## 🎨 Open for Vibe-Coders! 🤝

**Vibe-coders, AI-assisted hackers, and open-source enthusiasts are warmly welcome!**

This codebase is intentionally designed to be clean, modular, and easy for AI agents (Cursor, Claude, Gemini, Copilot) and human developers to extend:
- **Zero bloat:** No complex build systems or convoluted state management.
- **Clean modular structure:** React components under `src/components/`, lightweight backend in `server/`, native shell in `macos/`.
- **Ideas for PRs:**
  - [ ] Git Log & Commit Graph visualization
  - [ ] Compare with Branch / Revision dialog
  - [ ] Git Stash tab (alongside Shelf)
  - [ ] Interactive 3-way Merge Conflict resolver
  - [ ] Custom themes (Classic Darcula, Light theme)

Feel free to open an issue or submit a Pull Request!

---

## 📄 License

MIT License. Free to use, modify, and distribute.
