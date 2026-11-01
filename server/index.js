import http from 'http';
import url from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  getRepoRoot,
  getBranchInfo,
  getGitStatus,
  getFileAtRev,
  getLocalFileContent,
  saveLocalFileContent,
  rollbackFile,
  commitFiles,
  runGit,
  isGitRepo,
  initGitRepo,
} from './git.js';
import { ChangelistManager } from './changelists.js';
import { ShelfManager } from './shelf.js';
import { spawn, execFile } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist');

let defaultRepoRoot = process.cwd();

let appVersion = '1.0.0';
try {
  const pkgPath = path.resolve(__dirname, '../package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    appVersion = pkg.version || '1.0.0';
  }
} catch (e) {
  console.warn('Failed to read package.json version:', e);
}

// Terminal process & session management
const activeTerminalProcesses = new Map();
const terminalSessionCwd = new Map();

async function initRepo(initialPath) {
  if (initialPath && fs.existsSync(initialPath)) {
    const stat = fs.statSync(initialPath);
    const dir = stat.isDirectory() ? path.resolve(initialPath) : path.dirname(path.resolve(initialPath));
    const root = await getRepoRoot(dir);
    defaultRepoRoot = root || dir;
  }
  return defaultRepoRoot;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body && body.trim() ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function atomicWriteFile(filePath, content) {
  const tmpPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await fs.promises.writeFile(tmpPath, content, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Repo-Path',
  });
  res.end(JSON.stringify(data));
}

// Resolve repo for the current request
async function resolveRepoRoot(req, parsedUrl) {
  const customPath = req.headers['x-repo-path'] || parsedUrl.query.repo;
  if (customPath && typeof customPath === 'string') {
    if (fs.existsSync(customPath)) {
      const stat = fs.statSync(customPath);
      const dir = stat.isDirectory() ? path.resolve(customPath) : path.dirname(path.resolve(customPath));
      const root = await getRepoRoot(dir);
      return root || dir;
    }
  }
  return defaultRepoRoot;
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Repo-Path',
    });
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  try {
    // Validate or probe any repository path
    if (pathname === '/api/repo/validate' && (req.method === 'GET' || req.method === 'POST')) {
      const probePath = req.method === 'POST'
        ? (await parseJsonBody(req)).path
        : parsedUrl.query.path;

      if (!probePath) {
        return sendJson(res, 400, { error: 'path is required' });
      }

      // Clean path if dragged or pasted from Finder
      const cleanPath = probePath
        .replace(/^file:\/\//, '')
        .replace(/^['"]|['"]$/g, '')
        .trim();

      if (!fs.existsSync(cleanPath)) {
        return sendJson(res, 400, { error: 'Folder does not exist: ' + cleanPath });
      }

      const stat = await fs.promises.stat(cleanPath);
      const targetDir = stat.isDirectory() ? path.resolve(cleanPath) : path.dirname(path.resolve(cleanPath));

      const gitRoot = await getRepoRoot(targetDir);
      const finalRoot = gitRoot || targetDir;
      const isGit = !!gitRoot;
      const branchInfo = isGit ? await getBranchInfo(finalRoot) : { branch: 'no git' };

      return sendJson(res, 200, {
        valid: true,
        repoRoot: finalRoot,
        repoName: path.basename(finalRoot),
        branch: branchInfo.branch,
        isGit,
      });
    }

    // Project History & Tabs persistence
    if (pathname === '/api/projects/history') {
      const historyFile = path.join(os.homedir(), '.webstorm_git_projects.json');
      if (req.method === 'GET') {
        try {
          if (fs.existsSync(historyFile)) {
            const raw = await fs.promises.readFile(historyFile, 'utf8');
            if (raw && raw.trim()) {
              const data = JSON.parse(raw);
              return sendJson(res, 200, {
                projects: Array.isArray(data.projects) ? data.projects : [],
                recent: Array.isArray(data.recent) ? data.recent : [],
              });
            }
          }
        } catch (e) {
          console.warn('Recovered from invalid history file, resetting history:', e.message);
        }
        return sendJson(res, 200, { projects: [], recent: [] });
      }

      if (req.method === 'POST') {
        try {
          const body = await parseJsonBody(req);
          let current = { projects: [], recent: [] };
          if (fs.existsSync(historyFile)) {
            try {
              const raw = await fs.promises.readFile(historyFile, 'utf8');
              if (raw && raw.trim()) {
                const parsed = JSON.parse(raw);
                current = {
                  projects: Array.isArray(parsed.projects) ? parsed.projects : [],
                  recent: Array.isArray(parsed.recent) ? parsed.recent : [],
                };
              }
            } catch {}
          }
          const updated = {
            projects: Array.isArray(body.projects) ? body.projects : current.projects,
            recent: Array.isArray(body.recent) ? body.recent : current.recent,
          };
          await atomicWriteFile(historyFile, JSON.stringify(updated, null, 2));
          return sendJson(res, 200, { ok: true });
        } catch (e) {
          return sendJson(res, 500, { error: e.message });
        }
      }
    }

    // Native macOS folder picker dialog
    if (pathname === '/api/dialog/open-folder' && req.method === 'POST') {
      try {
        const { exec } = await import('child_process');
        exec("osascript -e 'POSIX path of (choose folder with prompt \"Select Folder or Project\")'", (err, stdout) => {
          if (err) {
            // User cancelled
            return sendJson(res, 200, { cancelled: true });
          }
          const chosenPath = stdout.trim();
          sendJson(res, 200, { path: chosenPath });
        });
        return;
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    const currentRepo = await resolveRepoRoot(req, parsedUrl);
    const changelistMgr = new ChangelistManager(currentRepo);
    const shelfMgr = new ShelfManager(currentRepo);

    // App Version & Update APIs
    if (pathname === '/api/app/version' && req.method === 'GET') {
      return sendJson(res, 200, {
        version: appVersion,
        repo: 'albertincx/ultra-git',
        githubUrl: 'https://github.com/albertincx/ultra-git',
      });
    }

    if (pathname === '/api/app/open-url' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (body.url) {
        execFile('open', [body.url], (err) => {
          if (err) console.error('Failed to open url:', err);
        });
      }
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/app/check-updates' && (req.method === 'GET' || req.method === 'POST')) {
      const GITHUB_REPO = 'albertincx/ultra-git';
      try {
        const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          headers: {
            'User-Agent': 'ultra-git-updater',
            'Accept': 'application/vnd.github.v3+json',
          },
        });

        if (ghRes.ok) {
          const data = await ghRes.json();
          const latestTag = data.tag_name || data.name || '';
          const cleanLatest = latestTag.replace(/^v/, '').trim();
          const cleanCurrent = appVersion.replace(/^v/, '').trim();

          const hasUpdate = cleanLatest !== cleanCurrent;
          let downloadUrl = data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`;
          if (data.assets && data.assets.length > 0) {
            const macAsset = data.assets.find((a) => a.name.includes('mac') || a.name.endsWith('.zip') || a.name.endsWith('.dmg'));
            if (macAsset && macAsset.browser_download_url) {
              downloadUrl = macAsset.browser_download_url;
            }
          }

          return sendJson(res, 200, {
            currentVersion: appVersion,
            latestVersion: cleanLatest,
            tagName: latestTag,
            hasUpdate,
            downloadUrl,
            releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
            releaseNotes: data.body || '',
            publishedAt: data.published_at || '',
            releaseName: data.name || latestTag,
          });
        }

        // Fallback: check tags if no formal release
        const tagsRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/tags`, {
          headers: {
            'User-Agent': 'ultra-git-updater',
            'Accept': 'application/vnd.github.v3+json',
          },
        });

        if (tagsRes.ok) {
          const tags = await tagsRes.json();
          if (Array.isArray(tags) && tags.length > 0) {
            const latestTag = tags[0].name || '';
            const cleanLatest = latestTag.replace(/^v/, '').trim();
            const cleanCurrent = appVersion.replace(/^v/, '').trim();
            const hasUpdate = cleanLatest !== cleanCurrent;

            return sendJson(res, 200, {
              currentVersion: appVersion,
              latestVersion: cleanLatest,
              tagName: latestTag,
              hasUpdate,
              downloadUrl: `https://github.com/${GITHUB_REPO}/releases/tag/${latestTag}`,
              releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
              releaseNotes: 'New version available from GitHub tags.',
              publishedAt: '',
              releaseName: latestTag,
            });
          }
        }

        // No releases or tags yet
        return sendJson(res, 200, {
          currentVersion: appVersion,
          latestVersion: appVersion,
          tagName: `v${appVersion}`,
          hasUpdate: false,
          downloadUrl: `https://github.com/${GITHUB_REPO}/releases`,
          releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
          releaseNotes: '',
          publishedAt: '',
          message: 'Up to date. No newer releases found on GitHub.',
        });
      } catch (err) {
        return sendJson(res, 200, {
          currentVersion: appVersion,
          latestVersion: appVersion,
          hasUpdate: false,
          error: err.message,
          downloadUrl: `https://github.com/${GITHUB_REPO}/releases`,
          releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
        });
      }
    }

    if (pathname === '/api/repo' && req.method === 'GET') {
      const isGit = await isGitRepo(currentRepo);
      const branchInfo = isGit ? await getBranchInfo(currentRepo) : { branch: 'no git' };
      return sendJson(res, 200, {
        repoRoot: currentRepo,
        repoName: path.basename(currentRepo),
        branch: branchInfo.branch,
        isGit,
      });
    }

    if (pathname === '/api/repo/set' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.path || !fs.existsSync(body.path)) {
        return sendJson(res, 400, { error: 'Folder does not exist' });
      }
      const stat = await fs.promises.stat(body.path);
      const targetDir = stat.isDirectory() ? path.resolve(body.path) : path.dirname(path.resolve(body.path));
      const gitRoot = await getRepoRoot(targetDir);
      defaultRepoRoot = gitRoot || targetDir;
      const isGit = !!gitRoot;
      const branchInfo = isGit ? await getBranchInfo(defaultRepoRoot) : { branch: 'no git' };
      return sendJson(res, 200, {
        repoRoot: defaultRepoRoot,
        repoName: path.basename(defaultRepoRoot),
        branch: branchInfo.branch,
        isGit,
      });
    }

    if (pathname === '/api/git/init' && req.method === 'POST') {
      try {
        await initGitRepo(currentRepo);
        const branchInfo = await getBranchInfo(currentRepo);
        return sendJson(res, 200, {
          success: true,
          repoRoot: currentRepo,
          repoName: path.basename(currentRepo),
          branch: branchInfo.branch,
          isGit: true,
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message || 'Failed to initialize Git repository' });
      }
    }

    // Terminal APIs
    if (pathname === '/api/terminal/info' && req.method === 'GET') {
      const sessionId = parsedUrl.query.sessionId || 'default';
      const sessionCwd = terminalSessionCwd.get(sessionId) || currentRepo;
      return sendJson(res, 200, {
        cwd: sessionCwd,
        repoRoot: currentRepo,
        repoName: path.basename(currentRepo),
      });
    }

    if (pathname === '/api/terminal/reset' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const sessionId = body.sessionId || 'default';
      terminalSessionCwd.set(sessionId, currentRepo);
      return sendJson(res, 200, { cwd: currentRepo, repoRoot: currentRepo });
    }

    if (pathname === '/api/terminal/kill' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { execId } = body;
      if (execId && activeTerminalProcesses.has(execId)) {
        const proc = activeTerminalProcesses.get(execId);
        try {
          proc.kill('SIGINT');
          setTimeout(() => {
            try { proc.kill('SIGTERM'); } catch {}
          }, 400);
        } catch (e) {
          console.warn('Kill process error:', e);
        }
        activeTerminalProcesses.delete(execId);
      }
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/terminal/exec' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { command, sessionId = 'default', execId } = body;

      if (!command || typeof command !== 'string') {
        return sendJson(res, 400, { error: 'command is required' });
      }

      let sessionCwd = body.cwd || terminalSessionCwd.get(sessionId) || currentRepo;
      if (!fs.existsSync(sessionCwd)) {
        sessionCwd = currentRepo;
      }

      const trimmed = command.trim();

      // Set up SSE streaming response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Repo-Path',
      });

      // Special handling for cd
      if (trimmed === 'cd' || trimmed.startsWith('cd ') || trimmed.startsWith('cd\t')) {
        const arg = trimmed === 'cd' ? '' : trimmed.slice(2).trim();
        let targetDir = '';
        if (!arg || arg === '~') {
          targetDir = os.homedir();
        } else if (arg.startsWith('~/')) {
          targetDir = path.join(os.homedir(), arg.slice(2));
        } else if (path.isAbsolute(arg)) {
          targetDir = path.normalize(arg);
        } else {
          targetDir = path.resolve(sessionCwd, arg);
        }

        if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
          sessionCwd = targetDir;
          terminalSessionCwd.set(sessionId, sessionCwd);
          res.write(`data: ${JSON.stringify({ type: 'exit', code: 0, cwd: sessionCwd })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ type: 'stderr', text: `cd: no such file or directory: ${arg}\n` })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'exit', code: 1, cwd: sessionCwd })}\n\n`);
        }
        res.end();
        return;
      }

      // Shell execution
      const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');
      let child;
      try {
        child = spawn(shell, ['-c', command], {
          cwd: sessionCwd,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            FORCE_COLOR: '1',
            CLICOLOR_FORCE: '1',
          },
        });
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message, cwd: sessionCwd })}\n\n`);
        res.end();
        return;
      }

      if (execId) {
        activeTerminalProcesses.set(execId, child);
      }

      req.on('close', () => {
        if (execId && activeTerminalProcesses.has(execId)) {
          try {
            child.kill('SIGINT');
          } catch {}
          activeTerminalProcesses.delete(execId);
        }
      });

      child.stdout.on('data', (data) => {
        res.write(`data: ${JSON.stringify({ type: 'stdout', text: data.toString() })}\n\n`);
      });

      child.stderr.on('data', (data) => {
        res.write(`data: ${JSON.stringify({ type: 'stderr', text: data.toString() })}\n\n`);
      });

      child.on('close', (code, signal) => {
        if (execId) activeTerminalProcesses.delete(execId);
        const exitCode = code !== null ? code : (signal ? 130 : 0);
        res.write(`data: ${JSON.stringify({ type: 'exit', code: exitCode, signal, cwd: sessionCwd })}\n\n`);
        res.end();
      });

      child.on('error', (err) => {
        if (execId) activeTerminalProcesses.delete(execId);
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message, cwd: sessionCwd })}\n\n`);
        res.end();
      });

      return;
    }
    // Open / Reveal in macOS Finder
    if (pathname === '/api/fs/open-in-finder' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.path && body.path !== '') {
        return sendJson(res, 400, { error: 'path required' });
      }
      const targetPath = body.path;
      const fullPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(currentRepo, targetPath);

      if (!fs.existsSync(fullPath)) {
        return sendJson(res, 404, { error: 'Path not found on disk: ' + fullPath });
      }

      try {
        const stat = await fs.promises.stat(fullPath);
        // If directory, open folder; if file, reveal file with -R
        const args = stat.isDirectory() ? [fullPath] : ['-R', fullPath];

        execFile('open', args, (err) => {
          if (err) {
            console.error('Failed to open in Finder:', err);
            return sendJson(res, 500, { error: err.message });
          }
          return sendJson(res, 200, { success: true, path: fullPath });
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
      return;
    }

    if (pathname === '/api/fs/dir' && req.method === 'GET') {
      const currentRepo = await resolveRepoRoot(req, parsedUrl);
      const subPath = parsedUrl.query.path || '';
      const dirFullPath = path.resolve(currentRepo, subPath);

      if (!dirFullPath.startsWith(currentRepo)) {
        return sendJson(res, 403, { error: 'Access denied' });
      }

      if (!fs.existsSync(dirFullPath)) {
        return sendJson(res, 404, { error: 'Directory not found' });
      }

      const entries = await fs.promises.readdir(dirFullPath, { withFileTypes: true });
      const isGit = await isGitRepo(currentRepo);
      const gitFiles = isGit ? await getGitStatus(currentRepo) : [];
      const statusMap = new Map(gitFiles.map((f) => [f.path, f.status]));

      const result = [];
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === '.DS_Store') continue;
        const relPath = path.relative(currentRepo, path.join(dirFullPath, entry.name));
        const isDir = entry.isDirectory();
        const gitStatus = statusMap.get(relPath);

        result.push({
          name: entry.name,
          path: relPath,
          isDir,
          gitStatus,
        });
      }

      result.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return sendJson(res, 200, result);
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      const isGit = await isGitRepo(currentRepo);
      if (!isGit) {
        return sendJson(res, 200, {
          files: [],
          changelists: {
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
          },
          branch: 'no git',
          repoRoot: currentRepo,
          isGit: false,
        });
      }

      const files = await getGitStatus(currentRepo);
      const changelists = await changelistMgr.syncWithStatus(files);
      const branchInfo = await getBranchInfo(currentRepo);

      return sendJson(res, 200, {
        files,
        changelists,
        branch: branchInfo.branch,
        repoRoot: currentRepo,
        isGit: true,
      });
    }

    if (pathname === '/api/file/content' && req.method === 'GET') {
      const filePath = parsedUrl.query.path;
      if (!filePath) {
        return sendJson(res, 400, { error: 'path is required' });
      }
      const rev = parsedUrl.query.rev || 'HEAD';
      const [original, modified] = await Promise.all([
        getFileAtRev(currentRepo, filePath, rev),
        getLocalFileContent(currentRepo, filePath),
      ]);

      return sendJson(res, 200, { original, modified, path: filePath });
    }

    if (pathname === '/api/file/compare' && req.method === 'GET') {
      const path1 = parsedUrl.query.path1;
      const path2 = parsedUrl.query.path2;
      if (!path1 || !path2) {
        return sendJson(res, 400, { error: 'path1 and path2 are required' });
      }
      const [content1, content2] = await Promise.all([
        getLocalFileContent(currentRepo, path1),
        getLocalFileContent(currentRepo, path2),
      ]);

      return sendJson(res, 200, { path1, path2, content1, content2 });
    }

    if (pathname === '/api/file/save' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.path || body.content === undefined) {
        return sendJson(res, 400, { error: 'path and content required' });
      }
      await saveLocalFileContent(currentRepo, body.path, body.content);
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/file/rollback' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.path) return sendJson(res, 400, { error: 'path required' });
      await rollbackFile(currentRepo, body.path, !!body.isUntracked);
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/file/stage' && req.method === 'POST') {
      const isGit = await isGitRepo(currentRepo);
      if (!isGit) return sendJson(res, 400, { error: 'Not a git repository' });
      const body = await parseJsonBody(req);
      if (!body.path) return sendJson(res, 400, { error: 'path required' });
      if (body.staged) {
        await runGit(['add', body.path], currentRepo);
      } else {
        await runGit(['restore', '--staged', body.path], currentRepo);
      }
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/commit' && req.method === 'POST') {
      const isGit = await isGitRepo(currentRepo);
      if (!isGit) return sendJson(res, 400, { error: 'Not a git repository' });
      const body = await parseJsonBody(req);
      if (!body.message) return sendJson(res, 400, { error: 'message required' });
      const result = await commitFiles(currentRepo, body.files || [], body.message);
      return sendJson(res, 200, { success: true, result });
    }

    // Changelist APIs
    if (pathname === '/api/changelists/create' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const data = await changelistMgr.createChangelist(body.name, body.comment, body.makeActive);
      return sendJson(res, 200, data);
    }

    if (pathname === '/api/changelists/move' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const data = await changelistMgr.moveFiles(body.files, body.targetId);
      return sendJson(res, 200, data);
    }

    if (pathname === '/api/changelists/delete' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const data = await changelistMgr.deleteChangelist(body.id, body.targetMoveId);
      return sendJson(res, 200, data);
    }

    if (pathname === '/api/changelists/active' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const data = await changelistMgr.setActive(body.id);
      return sendJson(res, 200, data);
    }

    // Shelf APIs
    if (pathname === '/api/shelf/list' && req.method === 'GET') {
      const list = await shelfMgr.getIndex();
      return sendJson(res, 200, list);
    }

    if (pathname === '/api/shelf/create' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.files || body.files.length === 0) {
        return sendJson(res, 400, { error: 'files list required' });
      }
      const entry = await shelfMgr.shelve(
        body.files,
        body.description || 'Shelved changes',
        body.revertWorkingCopy !== false
      );
      return sendJson(res, 200, entry);
    }

    if (pathname === '/api/shelf/patch' && req.method === 'GET') {
      const id = parsedUrl.query.id;
      if (!id) return sendJson(res, 400, { error: 'id required' });
      const patch = await shelfMgr.getShelfPatch(id);
      return sendJson(res, 200, { patch });
    }

    if (pathname === '/api/shelf/unshelve' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.id) return sendJson(res, 400, { error: 'id required' });
      const result = await shelfMgr.unshelve(body.id, !!body.keepInShelf);
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/shelf/delete' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.id) return sendJson(res, 400, { error: 'id required' });
      const list = await shelfMgr.deleteShelf(body.id);
      return sendJson(res, 200, list);
    }

    // Static files
    if (!pathname.startsWith('/api')) {
      if (serveStatic(req, res, pathname)) return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('API Error:', err);
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
});

const PORT = 3737;
initRepo(process.argv[2] || process.cwd()).then((repo) => {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`ultra Git Server running on http://127.0.0.1:${PORT}`);
    console.log(`Default Git Repo: ${repo}`);
  });
});
