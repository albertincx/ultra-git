import { GitFile, ChangelistState, ShelfItem, ProjectTab, FsEntry, RecentProject } from './types';

const API_BASE = '/api';

let activeRepoRoot: string = '';

export function setActiveRepoRoot(path: string) {
  activeRepoRoot = path;
}

export function getActiveRepoRoot() {
  return activeRepoRoot;
}

function getHeaders(customHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...customHeaders };
  if (activeRepoRoot) {
    headers['X-Repo-Path'] = activeRepoRoot;
  }
  return headers;
}

export async function openFolderDialog(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/dialog/open-folder`, {
    method: 'POST',
    headers: getHeaders(),
  });
  const data = await res.json();
  if (data.cancelled || !data.path) return null;
  return data.path;
}

export async function validateRepoPath(path: string): Promise<{ valid: boolean; repoRoot: string; repoName: string; branch: string }> {
  const res = await fetch(`${API_BASE}/repo/validate?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Invalid repository path');
  }
  return res.json();
}

export async function fetchDirEntries(subPath = ''): Promise<FsEntry[]> {
  const res = await fetch(`${API_BASE}/fs/dir?path=${encodeURIComponent(subPath)}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to read directory');
  return res.json();
}

export async function fetchRepoInfo(): Promise<{ repoRoot: string; repoName: string; branch: string }> {
  const res = await fetch(`${API_BASE}/repo`, {
    headers: getHeaders(),
  });
  return res.json();
}

export async function setRepoPath(path: string): Promise<{ repoRoot: string; repoName: string; branch: string }> {
  const res = await fetch(`${API_BASE}/repo/set`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to open repository');
  }
  return res.json();
}

export async function fetchGitStatus(): Promise<{
  files: GitFile[];
  changelists: ChangelistState;
  branch: string;
  repoRoot: string;
}> {
  const res = await fetch(`${API_BASE}/status`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch git status');
  return res.json();
}

export async function fetchFileContent(filePath: string, rev = 'HEAD'): Promise<{ original: string; modified: string; path: string }> {
  const res = await fetch(`${API_BASE}/file/content?path=${encodeURIComponent(filePath)}&rev=${encodeURIComponent(rev)}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch file content');
  return res.json();
}

export async function saveFileContent(filePath: string, content: string): Promise<void> {
  const res = await fetch(`${API_BASE}/file/save`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path: filePath, content }),
  });
  if (!res.ok) throw new Error('Failed to save file');
}

export async function rollbackFile(filePath: string, isUntracked = false): Promise<void> {
  const res = await fetch(`${API_BASE}/file/rollback`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path: filePath, isUntracked }),
  });
  if (!res.ok) throw new Error('Failed to rollback file');
}

export async function stageFile(filePath: string, staged: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/file/stage`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path: filePath, staged }),
  });
  if (!res.ok) throw new Error('Failed to stage file');
}

export async function commitChanges(files: string[], message: string): Promise<{ success: boolean; result: string }> {
  const res = await fetch(`${API_BASE}/commit`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ files, message }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to commit');
  }
  return res.json();
}

// Changelists
export async function createChangelist(name: string, comment = '', makeActive = false): Promise<ChangelistState> {
  const res = await fetch(`${API_BASE}/changelists/create`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, comment, makeActive }),
  });
  return res.json();
}

export async function moveFilesToChangelist(files: string[], targetId: string): Promise<ChangelistState> {
  const res = await fetch(`${API_BASE}/changelists/move`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ files, targetId }),
  });
  return res.json();
}

export async function deleteChangelist(id: string, targetMoveId = 'default'): Promise<ChangelistState> {
  const res = await fetch(`${API_BASE}/changelists/delete`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id, targetMoveId }),
  });
  return res.json();
}

export async function setActiveChangelist(id: string): Promise<ChangelistState> {
  const res = await fetch(`${API_BASE}/changelists/active`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id }),
  });
  return res.json();
}

// Shelf
export async function fetchShelfList(): Promise<ShelfItem[]> {
  const res = await fetch(`${API_BASE}/shelf/list`, {
    headers: getHeaders(),
  });
  return res.json();
}

export async function createShelf(files: string[], description: string, revertWorkingCopy = true): Promise<ShelfItem> {
  const res = await fetch(`${API_BASE}/shelf/create`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ files, description, revertWorkingCopy }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create shelf');
  }
  return res.json();
}

export async function getShelfPatch(id: string): Promise<string> {
  const res = await fetch(`${API_BASE}/shelf/patch?id=${encodeURIComponent(id)}`, {
    headers: getHeaders(),
  });
  const data = await res.json();
  return data.patch;
}

export async function unshelve(id: string, keepInShelf = false): Promise<void> {
  const res = await fetch(`${API_BASE}/shelf/unshelve`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id, keepInShelf }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to unshelve');
  }
}

export async function deleteShelf(id: string): Promise<ShelfItem[]> {
  const res = await fetch(`${API_BASE}/shelf/delete`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id }),
  });
  return res.json();
}

export async function fetchProjectHistory(): Promise<{ projects: ProjectTab[]; recent: RecentProject[] }> {
  try {
    const res = await fetch(`${API_BASE}/projects/history`);
    if (res.ok) return await res.json();
  } catch {}
  return { projects: [], recent: [] };
}

export async function saveProjectHistory(data: { projects?: ProjectTab[]; recent?: RecentProject[] }): Promise<void> {
  try {
    await fetch(`${API_BASE}/projects/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {}
}
