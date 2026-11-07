import { GitFile, ChangelistState, ShelfItem, ProjectTab, FsEntry, RecentProject, DirCompareResult } from './types';

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

export async function validateRepoPath(path: string): Promise<{
  valid: boolean;
  repoRoot: string;
  repoName: string;
  branch: string;
  isGit?: boolean;
}> {
  const res = await fetch(`${API_BASE}/repo/validate?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Invalid folder path');
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

export async function fetchRepoInfo(): Promise<{ repoRoot: string; repoName: string; branch: string; isGit?: boolean }> {
  const res = await fetch(`${API_BASE}/repo`, {
    headers: getHeaders(),
  });
  return res.json();
}

export async function initGitRepoApi(): Promise<{
  success: boolean;
  repoRoot: string;
  repoName: string;
  branch: string;
  isGit: boolean;
}> {
  const res = await fetch(`${API_BASE}/git/init`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to initialize Git repository');
  }
  return res.json();
}

export async function setRepoPath(path: string): Promise<{ repoRoot: string; repoName: string; branch: string; isGit?: boolean }> {
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
  isGit?: boolean;
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

const compareCache = new Map<string, { path1: string; path2: string; content1: string; content2: string; time: number }>();

export function clearCompareCache() {
  compareCache.clear();
}

export async function compareTwoFiles(path1: string, path2: string): Promise<{
  path1: string;
  path2: string;
  content1: string;
  content2: string;
}> {
  const cacheKey = `${activeRepoRoot}:${path1}:${path2}`;
  const cached = compareCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 60000) {
    return cached;
  }

  const res = await fetch(`${API_BASE}/file/compare?path1=${encodeURIComponent(path1)}&path2=${encodeURIComponent(path2)}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to compare files');
  const data = await res.json();
  compareCache.set(cacheKey, { ...data, time: Date.now() });
  return data;
}

export async function compareDirectories(dir1: string, dir2: string): Promise<DirCompareResult> {
  const res = await fetch(`${API_BASE}/dir/compare?dir1=${encodeURIComponent(dir1)}&dir2=${encodeURIComponent(dir2)}`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to compare directories');
  }
  return res.json();
}

export async function syncDirectoryFile(
  dir1: string,
  dir2: string,
  relPath: string,
  action: 'copy_to_right' | 'copy_to_left' | 'delete_left' | 'delete_right'
): Promise<void> {
  clearCompareCache();
  const res = await fetch(`${API_BASE}/dir/sync-file`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ dir1, dir2, relPath, action }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to sync directory file');
  }
}

export async function saveFileContent(filePath: string, content: string): Promise<void> {
  clearCompareCache();
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

export async function openInFinder(filePath: string): Promise<void> {
  const res = await fetch(`${API_BASE}/fs/open-in-finder`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path: filePath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to open in Finder');
  }
}

// App Update APIs
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  tagName?: string;
  hasUpdate: boolean;
  downloadUrl: string;
  releaseUrl: string;
  releaseNotes?: string;
  publishedAt?: string;
  releaseName?: string;
  error?: string;
  message?: string;
}

export async function fetchAppVersion(): Promise<{ version: string; repo: string; githubUrl: string }> {
  try {
    const res = await fetch(`${API_BASE}/app/version`);
    if (res.ok) return await res.json();
  } catch {}
  return { version: '1.0.0', repo: 'albertincx/ultra-git', githubUrl: 'https://github.com/albertincx/ultra-git' };
}

export async function checkAppUpdates(): Promise<UpdateInfo> {
  const res = await fetch(`${API_BASE}/app/check-updates`);
  if (!res.ok) {
    throw new Error('Failed to check for updates from GitHub');
  }
  return res.json();
}

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/app/open-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {}
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {}
}

// Terminal APIs
export async function openNativeTerminal(targetPath?: string): Promise<void> {
  const p = targetPath || activeRepoRoot;
  try {
    await fetch(`${API_BASE}/terminal/open-native`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path: p }),
    });
  } catch (e) {
    console.error('Failed to open native terminal:', e);
  }
}

export async function fetchTerminalInfo(sessionId = 'default'): Promise<{ cwd: string; repoRoot: string; repoName: string }> {
  const res = await fetch(`${API_BASE}/terminal/info?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch terminal info');
  return res.json();
}

export async function resetTerminalCwd(sessionId = 'default'): Promise<{ cwd: string; repoRoot: string }> {
  const res = await fetch(`${API_BASE}/terminal/reset`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error('Failed to reset terminal');
  return res.json();
}

export async function killTerminalProcess(execId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/terminal/kill`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ execId }),
    });
  } catch (e) {
    console.warn('Kill process request failed:', e);
  }
}

export async function executeTerminalStream(
  command: string,
  options: {
    sessionId?: string;
    cwd?: string;
    execId?: string;
    onStdout?: (text: string) => void;
    onStderr?: (text: string) => void;
    onExit?: (code: number, cwd: string) => void;
    onError?: (error: string) => void;
    signal?: AbortSignal;
  }
): Promise<void> {
  const res = await fetch(`${API_BASE}/terminal/exec`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      command,
      sessionId: options.sessionId || 'default',
      cwd: options.cwd,
      execId: options.execId,
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || 'Terminal execution request failed');
  }

  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === 'stdout' && options.onStdout) {
              options.onStdout(data.text);
            } else if (data.type === 'stderr' && options.onStderr) {
              options.onStderr(data.text);
            } else if (data.type === 'exit' && options.onExit) {
              options.onExit(data.code, data.cwd);
            } else if (data.type === 'error' && options.onError) {
              options.onError(data.error);
            }
          } catch (e) {
            console.warn('Failed to parse SSE data:', trimmed, e);
          }
        }
      }
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      options.onError?.(err.message || 'Stream connection error');
    }
  }
}
