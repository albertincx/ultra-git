import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        // Some git diff calls return 1 if differences found, handle gracefully
        if (args[0] === 'diff' && code === 1) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `git ${args.join(' ')} failed with code ${code}`));
        }
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

/**
 * Check if directory is inside a Git working tree
 */
export async function isGitRepo(dir) {
  if (!dir) return false;
  try {
    if (!fs.existsSync(dir)) return false;
    const res = await runGit(['rev-parse', '--is-inside-work-tree'], dir);
    return res.trim() === 'true';
  } catch (e) {
    return false;
  }
}

/**
 * Initialize a new Git repository
 */
export async function initGitRepo(dir) {
  return await runGit(['init'], dir);
}

/**
 * Get repo root directory
 */
export async function getRepoRoot(dir) {
  if (!dir) return null;
  try {
    if (!fs.existsSync(dir)) return null;
    const res = await runGit(['rev-parse', '--show-toplevel'], dir);
    return res.trim();
  } catch (e) {
    return null;
  }
}

/**
 * Get current branch or detached HEAD info
 */
export async function getBranchInfo(repoRoot) {
  try {
    const isGit = await isGitRepo(repoRoot);
    if (!isGit) return { branch: 'no git' };
    const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)).trim();
    return { branch: branch === 'HEAD' ? 'main' : branch };
  } catch (e) {
    const isGit = await isGitRepo(repoRoot);
    return { branch: isGit ? 'main' : 'no git' };
  }
}

/**
 * Parse git status porcelain v2 format
 * 1 = ordinary changed entry
 * 2 = renamed/copied entry
 * u = unmerged entry
 * ? = untracked entry
 * ! = ignored entry
 */
export async function getGitStatus(repoRoot) {
  const isGit = await isGitRepo(repoRoot);
  if (!isGit) return [];

  let output = '';
  try {
    output = await runGit(['status', '--porcelain=v2', '-uall'], repoRoot);
  } catch (e) {
    return [];
  }
  const files = [];

  const lines = output.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(' ');
    const type = parts[0];

    if (type === '1') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const xy = parts[1];
      const indexStatus = xy[0];
      const workTreeStatus = xy[1];
      const filePath = parts.slice(8).join(' ');

      let status = 'modified';
      if (indexStatus === 'A' || workTreeStatus === 'A') status = 'added';
      else if (indexStatus === 'D' || workTreeStatus === 'D') status = 'deleted';
      else if (indexStatus === 'M' || workTreeStatus === 'M') status = 'modified';

      files.push({
        path: filePath,
        status,
        staged: indexStatus !== '.',
        workTreeStatus,
        indexStatus,
      });
    } else if (type === '2') {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><sep><origPath>
      const xy = parts[1];
      const full = parts.slice(9).join(' ');
      const [newPath, origPath] = full.split('\t');
      files.push({
        path: newPath || full,
        origPath,
        status: 'renamed',
        staged: xy[0] !== '.',
        workTreeStatus: xy[1],
        indexStatus: xy[0],
      });
    } else if (type === '?') {
      // ? <path>
      const filePath = parts.slice(1).join(' ');
      files.push({
        path: filePath,
        status: 'untracked',
        staged: false,
        workTreeStatus: '?',
        indexStatus: '?',
      });
    } else if (type === 'u') {
      // u <XY> ... conflict
      const filePath = parts.slice(10).join(' ');
      files.push({
        path: filePath,
        status: 'conflict',
        staged: false,
        workTreeStatus: 'u',
        indexStatus: 'u',
      });
    }
  }

  return files;
}

/**
 * Get file content at HEAD (or specified revision)
 */
export async function getFileAtRev(repoRoot, filePath, rev = 'HEAD') {
  try {
    return await runGit(['show', `${rev}:${filePath}`], repoRoot);
  } catch (e) {
    return ''; // file might be newly added or untracked
  }
}

/**
 * Get local working copy content of file
 */
export async function getLocalFileContent(repoRoot, filePath) {
  const fullPath = path.join(repoRoot, filePath);
  try {
    if (!fs.existsSync(fullPath)) return '';
    return await fs.promises.readFile(fullPath, 'utf8');
  } catch (e) {
    return '';
  }
}

/**
 * Save file to working copy
 */
export async function saveLocalFileContent(repoRoot, filePath, content) {
  const fullPath = path.join(repoRoot, filePath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, content, 'utf8');
}

/**
 * Revert / rollback a file
 */
export async function rollbackFile(repoRoot, filePath, isUntracked = false) {
  if (isUntracked) {
    const fullPath = path.join(repoRoot, filePath);
    if (fs.existsSync(fullPath)) {
      await fs.promises.rm(fullPath, { recursive: true, force: true });
    }
  } else {
    await runGit(['restore', '--staged', '--worktree', filePath], repoRoot);
  }
}

/**
 * Commit specific files
 */
export async function commitFiles(repoRoot, filePaths, message, author = null) {
  // 1. Stage the files
  if (filePaths.length > 0) {
    await runGit(['add', '--', ...filePaths], repoRoot);
  }
  // 2. Commit
  const args = ['commit', '-m', message];
  if (author) {
    args.push(`--author=${author}`);
  }
  return await runGit(args, repoRoot);
}
