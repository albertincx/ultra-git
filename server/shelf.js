import fs from 'fs';
import path from 'path';
import { runGit, rollbackFile, isGitRepo } from './git.js';

const SHELF_DIR = '.git/ultra_shelf';
const SHELF_INDEX = 'shelf_index.json';

export class ShelfManager {
  constructor(repoRoot) {
    this.repoRoot = repoRoot;
    this.shelfPath = path.join(repoRoot, SHELF_DIR);
    this.indexPath = path.join(this.shelfPath, SHELF_INDEX);
  }

  async ensureDir() {
    const isGit = await isGitRepo(this.repoRoot);
    if (!isGit) return false;
    await fs.promises.mkdir(this.shelfPath, { recursive: true });
    if (!fs.existsSync(this.indexPath)) {
      await fs.promises.writeFile(this.indexPath, JSON.stringify([], null, 2), 'utf8');
    }
    return true;
  }

  async getIndex() {
    const ok = await this.ensureDir();
    if (!ok) return [];
    try {
      const raw = await fs.promises.readFile(this.indexPath, 'utf8');
      if (raw && raw.trim()) {
        return JSON.parse(raw);
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  async saveIndex(index) {
    const ok = await this.ensureDir();
    if (!ok) return;
    const tmpPath = `${this.indexPath}.tmp.${Date.now()}`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(index, null, 2), 'utf8');
    await fs.promises.rename(tmpPath, this.indexPath);
  }

  /**
   * Shelve selected files
   * @param {string[]} filePaths
   * @param {string} description
   * @param {boolean} revertWorkingCopy
   */
  async shelve(filePaths, description = 'Shelved changes', revertWorkingCopy = true) {
    const ok = await this.ensureDir();
    if (!ok) throw new Error('Not a git repository');
    const id = 'shelf_' + Date.now();
    const patchFileName = `${id}.patch`;
    const patchFilePath = path.join(this.shelfPath, patchFileName);

    // 1. Generate patch
    // We diff against HEAD for modified/staged files
    let patch = '';
    try {
      patch = await runGit(['diff', 'HEAD', '--binary', '--', ...filePaths], this.repoRoot);
    } catch (e) {
      // If HEAD doesn't exist yet, try diff --cached or empty
      patch = '';
    }

    // Handle untracked files if any: if a file has no diff because it's untracked, create git-style patch or store content
    const fileEntries = [];
    for (const f of filePaths) {
      const full = path.join(this.repoRoot, f);
      let isUntracked = false;
      try {
        await runGit(['ls-files', '--error-unmatch', f], this.repoRoot);
      } catch (e) {
        isUntracked = true;
      }

      if (isUntracked && fs.existsSync(full)) {
        // Create an added file diff for untracked file
        try {
          const content = await fs.promises.readFile(full, 'utf8');
          const untrackedPatch = [
            `diff --git a/${f} b/${f}`,
            `new file mode 100644`,
            `--- /dev/null`,
            `+++ b/${f}`,
            `@@ -0,0 +1,${content.split('\n').length} @@`,
            ...content.split('\n').map((l) => `+${l}`),
            '',
          ].join('\n');
          patch += (patch ? '\n' : '') + untrackedPatch;
        } catch (e) {
          console.error('Error creating patch for untracked file', f, e);
        }
      }

      fileEntries.push({
        path: f,
        isUntracked,
      });
    }

    if (!patch.trim()) {
      throw new Error('No changes found in selected files to shelve');
    }

    // 2. Write patch file
    await fs.promises.writeFile(patchFilePath, patch, 'utf8');

    // 3. Update index
    const index = await this.getIndex();
    const entry = {
      id,
      description,
      createdAt: new Date().toISOString(),
      patchFile: patchFileName,
      files: fileEntries,
    };
    index.unshift(entry);
    await this.saveIndex(index);

    // 4. Revert files from working copy if requested
    if (revertWorkingCopy) {
      for (const f of fileEntries) {
        await rollbackFile(this.repoRoot, f.path, f.isUntracked);
      }
    }

    return entry;
  }

  /**
   * Get diff for a specific shelved entry
   */
  async getShelfPatch(id) {
    const patchPath = path.join(this.shelfPath, `${id}.patch`);
    if (!fs.existsSync(patchPath)) {
      throw new Error('Shelf patch file not found');
    }
    return await fs.promises.readFile(patchPath, 'utf8');
  }

  /**
   * Unshelve (apply patch)
   */
  async unshelve(id, keepInShelf = false) {
    const patchPath = path.join(this.shelfPath, `${id}.patch`);
    if (!fs.existsSync(patchPath)) {
      throw new Error('Shelf patch file not found');
    }

    // Apply patch using git apply
    try {
      await runGit(['apply', '--3way', '--whitespace=nowarn', patchPath], this.repoRoot);
    } catch (e) {
      // Try normal apply without 3way
      await runGit(['apply', '--whitespace=nowarn', patchPath], this.repoRoot);
    }

    if (!keepInShelf) {
      await this.deleteShelf(id);
    }

    return { success: true };
  }

  /**
   * Delete shelf item
   */
  async deleteShelf(id) {
    const patchPath = path.join(this.shelfPath, `${id}.patch`);
    if (fs.existsSync(patchPath)) {
      await fs.promises.unlink(patchPath);
    }
    const index = await this.getIndex();
    const updated = index.filter((item) => item.id !== id);
    await this.saveIndex(updated);
    return updated;
  }
}
