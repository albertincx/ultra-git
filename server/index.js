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

// Full-text search engine (ripgrep with git-grep / node fallback)
async function searchInDirectory(targetDir, query, options = {}) {
  const startTime = Date.now();
  const maxMatches = options.maxResults || 2000;
  const results = new Map();
  let totalMatches = 0;

  // 1. Try ripgrep (fastest search tool)
  const rgCandidates = ['/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg'];
  let rgPath = null;
  for (const c of rgCandidates) {
    if (fs.existsSync(c)) { rgPath = c; break; }
  }

  if (rgPath) {
    try {
      const args = [
        '--json',
        '--max-filesize', '5M',
        '--glob', '!.git/**',
        '--glob', '!node_modules/**',
        '--glob', '!dist/**',
        '--glob', '!build/**',
        '--glob', '!.DS_Store',
      ];
      if (!options.matchCase) args.push('-i');
      if (options.wholeWord) args.push('-w');
      if (!options.isRegex) args.push('-F');

      if (options.fileMask && options.fileMask.trim()) {
        const masks = options.fileMask.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
        masks.forEach((m) => {
          const globPattern = m.startsWith('*') ? m : `*${m}`;
          args.push('--glob', globPattern);
        });
      }

      args.push('-e', query);
      const searchTarget = options.scope ? path.resolve(targetDir, options.scope) : targetDir;
      args.push(searchTarget);

      const child = spawn(rgPath, args);
      let output = '';
      child.stdout.on('data', (d) => { output += d.toString(); });

      await new Promise((resolve) => {
        child.on('close', resolve);
        child.on('error', resolve);
      });

      const lines = output.split('\n');
      for (const line of lines) {
        if (!line.trim() || totalMatches >= maxMatches) break;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'match') {
            const rawPath = parsed.data.path.text;
            const relPath = path.relative(targetDir, rawPath);
            const lineNum = parsed.data.line_number;
            const lineText = parsed.data.lines.text.replace(/[\r\n]+$/, '');
            parsed.data.submatches.forEach((sub) => {
              if (totalMatches >= maxMatches) return;
              totalMatches++;
              if (!results.has(relPath)) {
                results.set(relPath, []);
              }
              results.get(relPath).push({
                line: lineNum,
                column: sub.start + 1,
                endColumn: sub.end + 1,
                matchText: sub.match.text,
                lineText: lineText.length > 500 ? lineText.slice(0, 500) + '...' : lineText,
              });
            });
          }
        } catch {}
      }

      const files = Array.from(results.entries()).map(([filePath, matches]) => ({
        filePath,
        fileName: path.basename(filePath),
        dirPath: path.dirname(filePath) === '.' ? '' : path.dirname(filePath),
        matches,
      }));

      return {
        query,
        totalMatches,
        totalFiles: files.length,
        files,
        durationMs: Date.now() - startTime,
        truncated: totalMatches >= maxMatches,
      };
    } catch (e) {
      console.warn('rg search failed, falling back:', e);
    }
  }

  // 2. Fallback: Git Grep
  try {
    const isGit = await isGitRepo(targetDir);
    if (isGit) {
      const gitArgs = ['grep', '-n', '-I', '--untracked', '--exclude-standard'];
      if (!options.matchCase) gitArgs.push('-i');
      if (options.wholeWord) gitArgs.push('-w');
      if (options.isRegex) gitArgs.push('-E');
      else gitArgs.push('-F');
      gitArgs.push('-e', query);
      gitArgs.push('--');
      if (options.scope) gitArgs.push(options.scope);
      if (options.fileMask) {
        const masks = options.fileMask.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
        masks.forEach((m) => gitArgs.push(m.startsWith('*') ? m : `*${m}`));
      }

      const stdout = await runGit(targetDir, gitArgs).catch(() => '');
      if (stdout) {
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (!line.trim() || totalMatches >= maxMatches) break;
          const firstColon = line.indexOf(':');
          const secondColon = line.indexOf(':', firstColon + 1);
          if (firstColon > 0 && secondColon > firstColon) {
            const relPath = line.slice(0, firstColon);
            const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10);
            const lineText = line.slice(secondColon + 1);
            const colIndex = options.matchCase
              ? lineText.indexOf(query)
              : lineText.toLowerCase().indexOf(query.toLowerCase());
            totalMatches++;
            if (!results.has(relPath)) results.set(relPath, []);
            results.get(relPath).push({
              line: lineNum,
              column: colIndex >= 0 ? colIndex + 1 : 1,
              endColumn: colIndex >= 0 ? colIndex + 1 + query.length : 1,
              matchText: colIndex >= 0 ? lineText.slice(colIndex, colIndex + query.length) : query,
              lineText: lineText.length > 500 ? lineText.slice(0, 500) + '...' : lineText,
            });
          }
        }
      }

      const files = Array.from(results.entries()).map(([filePath, matches]) => ({
        filePath,
        fileName: path.basename(filePath),
        dirPath: path.dirname(filePath) === '.' ? '' : path.dirname(filePath),
        matches,
      }));

      return {
        query,
        totalMatches,
        totalFiles: files.length,
        files,
        durationMs: Date.now() - startTime,
        truncated: totalMatches >= maxMatches,
      };
    }
  } catch (e) {
    console.warn('git grep fallback error:', e);
  }

  return {
    query,
    totalMatches: 0,
    totalFiles: 0,
    files: [],
    durationMs: Date.now() - startTime,
    truncated: false,
  };
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
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
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
                activeProjectId: data.activeProjectId || '',
                activeRepoRoot: data.activeRepoRoot || '',
              });
            }
          }
        } catch (e) {
          console.warn('Recovered from invalid history file, resetting history:', e.message);
        }
        return sendJson(res, 200, { projects: [], recent: [], activeProjectId: '', activeRepoRoot: '' });
      }

      if (req.method === 'POST') {
        try {
          const body = await parseJsonBody(req);
          let current = { projects: [], recent: [], activeProjectId: '', activeRepoRoot: '' };
          if (fs.existsSync(historyFile)) {
            try {
              const raw = await fs.promises.readFile(historyFile, 'utf8');
              if (raw && raw.trim()) {
                const parsed = JSON.parse(raw);
                current = {
                  projects: Array.isArray(parsed.projects) ? parsed.projects : [],
                  recent: Array.isArray(parsed.recent) ? parsed.recent : [],
                  activeProjectId: parsed.activeProjectId || '',
                  activeRepoRoot: parsed.activeRepoRoot || '',
                };
              }
            } catch {}
          }
          const updated = {
            projects: Array.isArray(body.projects) ? body.projects : current.projects,
            recent: Array.isArray(body.recent) ? body.recent : current.recent,
            activeProjectId: body.activeProjectId !== undefined ? body.activeProjectId : current.activeProjectId,
            activeRepoRoot: body.activeRepoRoot !== undefined ? body.activeRepoRoot : current.activeRepoRoot,
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
    if (pathname === '/api/terminal/open-native' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req).catch(() => ({}));
        const targetDir = body.path || currentRepo || defaultRepoRoot;
        execFile('open', ['-a', 'Terminal', targetDir], (err) => {
          if (err) console.error('Failed to open native macOS Terminal:', err);
        });
        return sendJson(res, 200, { ok: true, path: targetDir });
      } catch (e) {
        return sendJson(res, 500, { error: e.message });
      }
    }

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

    // Full-text project search (Find in Files / Path)
    if (pathname === '/api/search' && (req.method === 'GET' || req.method === 'POST')) {
      const currentRepo = await resolveRepoRoot(req, parsedUrl);
      const params = req.method === 'POST' ? await parseJsonBody(req) : parsedUrl.query;
      const query = (params.query || '').trim();

      if (!query) {
        return sendJson(res, 200, {
          query: '',
          totalMatches: 0,
          totalFiles: 0,
          files: [],
          durationMs: 0,
        });
      }

      const matchCase = params.matchCase === true || params.matchCase === 'true';
      const wholeWord = params.wholeWord === true || params.wholeWord === 'true';
      const isRegex = params.isRegex === true || params.isRegex === 'true';
      const fileMask = (params.fileMask || '').trim();
      const scope = (params.scope || '').trim();
      const maxResults = parseInt(params.maxResults, 10) || 2000;

      const searchResult = await searchInDirectory(currentRepo, query, {
        matchCase,
        wholeWord,
        isRegex,
        fileMask,
        scope,
        maxResults,
      });

      return sendJson(res, 200, searchResult);
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

    // Compare two directories recursively (WebStorm style directory compare)
    if (pathname === '/api/dir/compare' && req.method === 'GET') {
      const dir1 = parsedUrl.query.dir1 !== undefined ? String(parsedUrl.query.dir1).trim() : null;
      const dir2 = parsedUrl.query.dir2 !== undefined ? String(parsedUrl.query.dir2).trim() : null;
      if (dir1 === null || dir2 === null) {
        return sendJson(res, 400, { error: 'dir1 and dir2 are required' });
      }

      const fullPath1 = path.resolve(currentRepo, dir1);
      const fullPath2 = path.resolve(currentRepo, dir2);

      if (!fullPath1.startsWith(currentRepo) || !fullPath2.startsWith(currentRepo)) {
        return sendJson(res, 403, { error: 'Access denied: directory outside project' });
      }

      if (!fs.existsSync(fullPath1) || !fs.statSync(fullPath1).isDirectory()) {
        return sendJson(res, 400, { error: `Directory 1 does not exist or is not a directory: ${dir1}` });
      }
      if (!fs.existsSync(fullPath2) || !fs.statSync(fullPath2).isDirectory()) {
        return sendJson(res, 400, { error: `Directory 2 does not exist or is not a directory: ${dir2}` });
      }

      async function getDirFilesRecursive(baseDir, currentRel = '') {
        const fullDir = currentRel ? path.join(baseDir, currentRel) : baseDir;
        let entries = [];
        try {
          entries = await fs.promises.readdir(fullDir, { withFileTypes: true });
        } catch {
          return new Map();
        }
        const map = new Map();
        for (const entry of entries) {
          if (entry.name === '.git' || entry.name === '.DS_Store') continue;
          const relPath = currentRel ? `${currentRel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            const sub = await getDirFilesRecursive(baseDir, relPath);
            for (const [k, v] of sub.entries()) {
              map.set(k, v);
            }
          } else if (entry.isFile()) {
            try {
              const stat = await fs.promises.stat(path.join(baseDir, relPath));
              map.set(relPath, {
                size: stat.size,
                mtime: stat.mtimeMs,
              });
            } catch {}
          }
        }
        return map;
      }

      const [files1, files2] = await Promise.all([
        getDirFilesRecursive(fullPath1),
        getDirFilesRecursive(fullPath2),
      ]);

      const allKeys = new Set([...files1.keys(), ...files2.keys()]);
      const items = [];
      let differentCount = 0;
      let leftOnlyCount = 0;
      let rightOnlyCount = 0;
      let sameCount = 0;

      for (const relPath of allKeys) {
        const in1 = files1.has(relPath);
        const in2 = files2.has(relPath);
        const info1 = files1.get(relPath);
        const info2 = files2.get(relPath);
        const name = path.basename(relPath);

        if (in1 && !in2) {
          leftOnlyCount++;
          items.push({
            relPath,
            name,
            status: 'left_only',
            size1: info1.size,
            size2: null,
            mtime1: info1.mtime,
            mtime2: null,
          });
        } else if (!in1 && in2) {
          rightOnlyCount++;
          items.push({
            relPath,
            name,
            status: 'right_only',
            size1: null,
            size2: info2.size,
            mtime1: null,
            mtime2: info2.mtime,
          });
        } else {
          // Both exist
          if (info1.size !== info2.size) {
            differentCount++;
            items.push({
              relPath,
              name,
              status: 'different',
              size1: info1.size,
              size2: info2.size,
              mtime1: info1.mtime,
              mtime2: info2.mtime,
            });
          } else {
            // Compare buffer/content
            try {
              const [buf1, buf2] = await Promise.all([
                fs.promises.readFile(path.join(fullPath1, relPath)),
                fs.promises.readFile(path.join(fullPath2, relPath)),
              ]);
              if (buf1.equals(buf2)) {
                sameCount++;
                items.push({
                  relPath,
                  name,
                  status: 'same',
                  size1: info1.size,
                  size2: info2.size,
                  mtime1: info1.mtime,
                  mtime2: info2.mtime,
                });
              } else {
                differentCount++;
                items.push({
                  relPath,
                  name,
                  status: 'different',
                  size1: info1.size,
                  size2: info2.size,
                  mtime1: info1.mtime,
                  mtime2: info2.mtime,
                });
              }
            } catch {
              differentCount++;
              items.push({
                relPath,
                name,
                status: 'different',
                size1: info1.size,
                size2: info2.size,
                mtime1: info1.mtime,
                mtime2: info2.mtime,
              });
            }
          }
        }
      }

      // Sort items: different first, then left_only, then right_only, then same, alphabetically by relPath
      const statusPriority = { different: 1, left_only: 2, right_only: 3, same: 4 };
      items.sort((a, b) => {
        const pDiff = (statusPriority[a.status] || 99) - (statusPriority[b.status] || 99);
        if (pDiff !== 0) return pDiff;
        return a.relPath.localeCompare(b.relPath);
      });

      return sendJson(res, 200, {
        dir1,
        dir2,
        items,
        summary: {
          total: items.length,
          different: differentCount,
          leftOnly: leftOnlyCount,
          rightOnly: rightOnlyCount,
          same: sameCount,
        },
      });
    }

    // Sync or copy file between two compared directories
    if (pathname === '/api/dir/sync-file' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { dir1, dir2, relPath, action } = body;
      if (dir1 === undefined || dir2 === undefined || !relPath || !action) {
        return sendJson(res, 400, { error: 'dir1, dir2, relPath, and action are required' });
      }

      const fullPath1 = path.resolve(currentRepo, dir1, relPath);
      const fullPath2 = path.resolve(currentRepo, dir2, relPath);

      if (!fullPath1.startsWith(currentRepo) || !fullPath2.startsWith(currentRepo)) {
        return sendJson(res, 403, { error: 'Access denied: path outside project' });
      }

      if (action === 'copy_to_right') {
        if (!fs.existsSync(fullPath1)) {
          return sendJson(res, 400, { error: 'Source file does not exist on left side' });
        }
        await fs.promises.mkdir(path.dirname(fullPath2), { recursive: true });
        await fs.promises.copyFile(fullPath1, fullPath2);
        return sendJson(res, 200, { success: true });
      } else if (action === 'copy_to_left') {
        if (!fs.existsSync(fullPath2)) {
          return sendJson(res, 400, { error: 'Source file does not exist on right side' });
        }
        await fs.promises.mkdir(path.dirname(fullPath1), { recursive: true });
        await fs.promises.copyFile(fullPath2, fullPath1);
        return sendJson(res, 200, { success: true });
      } else if (action === 'delete_left') {
        if (fs.existsSync(fullPath1)) {
          await fs.promises.unlink(fullPath1);
        }
        return sendJson(res, 200, { success: true });
      } else if (action === 'delete_right') {
        if (fs.existsSync(fullPath2)) {
          await fs.promises.unlink(fullPath2);
        }
        return sendJson(res, 200, { success: true });
      } else {
        return sendJson(res, 400, { error: `Invalid action: ${action}` });
      }
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

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3737;
initRepo(process.argv[2] || process.cwd()).then((repo) => {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`ultra Git Server running on http://127.0.0.1:${PORT}`);
    console.log(`Default Git Repo: ${repo}`);
  });
});
