import fs from 'fs';
import path from 'path';

const CHANGELISTS_FILE = '.git/ultra_changelists.json';

export class ChangelistManager {
  constructor(repoRoot) {
    this.repoRoot = repoRoot;
    this.filePath = path.join(repoRoot, CHANGELISTS_FILE);
  }

  async load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = await fs.promises.readFile(this.filePath, 'utf8');
        if (raw && raw.trim()) {
          return JSON.parse(raw);
        }
      }
    } catch (e) {
      console.warn('Error loading changelists:', e.message);
    }
    return {
      activeId: 'default',
      changelists: [
        {
          id: 'default',
          name: 'Changes',
          comment: 'Default changelist',
          isDefault: true,
          filePaths: [],
        },
      ],
    };
  }

  async save(data) {
    try {
      const gitDir = path.dirname(this.filePath);
      if (fs.existsSync(gitDir)) {
        const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
        await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
        await fs.promises.rename(tmpPath, this.filePath);
      }
    } catch (e) {
      console.error('Error saving changelists:', e);
    }
  }

  /**
   * Synchronize registered changelists with current changed files from git status.
   * If a file changed and is not in any changelist, put it in active changelist.
   * If a file is no longer changed, remove it from list.
   */
  async syncWithStatus(currentFiles) {
    const data = await this.load();
    const currentPaths = new Set(currentFiles.map((f) => f.path));
    const allAssigned = new Set();

    // Clean up removed files
    for (const cl of data.changelists) {
      cl.filePaths = (cl.filePaths || []).filter((p) => currentPaths.has(p));
      for (const p of cl.filePaths) {
        allAssigned.add(p);
      }
    }

    // Find active changelist
    let activeCl = data.changelists.find((c) => c.id === data.activeId);
    if (!activeCl) {
      activeCl = data.changelists[0];
      data.activeId = activeCl.id;
    }

    // Assign unassigned files to active changelist
    for (const file of currentFiles) {
      if (!allAssigned.has(file.path)) {
        activeCl.filePaths.push(file.path);
        allAssigned.add(file.path);
      }
    }

    await this.save(data);
    return data;
  }

  async createChangelist(name, comment = '', makeActive = false) {
    const data = await this.load();
    const id = 'cl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const newCl = {
      id,
      name,
      comment,
      isDefault: false,
      filePaths: [],
    };
    data.changelists.push(newCl);
    if (makeActive) {
      data.activeId = id;
    }
    await this.save(data);
    return data;
  }

  async moveFiles(filePaths, targetChangelistId) {
    const data = await this.load();
    const target = data.changelists.find((c) => c.id === targetChangelistId);
    if (!target) throw new Error('Target changelist not found');

    const pathSet = new Set(filePaths);
    // Remove from other changelists
    for (const cl of data.changelists) {
      if (cl.id !== targetChangelistId) {
        cl.filePaths = cl.filePaths.filter((p) => !pathSet.has(p));
      }
    }

    // Add to target without duplicates
    const existing = new Set(target.filePaths);
    for (const p of filePaths) {
      if (!existing.has(p)) {
        target.filePaths.push(p);
      }
    }

    await this.save(data);
    return data;
  }

  async deleteChangelist(id, targetMoveId = 'default') {
    const data = await this.load();
    const clIndex = data.changelists.findIndex((c) => c.id === id);
    if (clIndex === -1) return data;
    const cl = data.changelists[clIndex];
    if (cl.isDefault) throw new Error('Cannot delete default changelist');

    // Move its files to target
    const target = data.changelists.find((c) => c.id === targetMoveId) || data.changelists[0];
    if (target) {
      const existing = new Set(target.filePaths);
      for (const p of cl.filePaths) {
        if (!existing.has(p)) target.filePaths.push(p);
      }
    }

    data.changelists.splice(clIndex, 1);
    if (data.activeId === id) {
      data.activeId = target ? target.id : data.changelists[0].id;
    }

    await this.save(data);
    return data;
  }

  async setActive(id) {
    const data = await this.load();
    if (data.changelists.some((c) => c.id === id)) {
      data.activeId = id;
      await this.save(data);
    }
    return data;
  }
}
