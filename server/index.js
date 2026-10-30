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
} from './git.js';
import { ChangelistManager } from './changelists.js';
import { ShelfManager } from './shelf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist');

let defaultRepoRoot = process.cwd();

async function initRepo(initialPath) {
  const root = await getRepoRoot(initialPath);
  if (root) {
    defaultRepoRoot = root;
  }
  return defaultRepoRoot;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
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
    const root = await getRepoRoot(customPath);
    if (root) return root;
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

      const root = await getRepoRoot(cleanPath);
      if (!root) {
        return sendJson(res, 400, { error: 'Not a valid git repository: ' + cleanPath });
      }

      const branchInfo = await getBranchInfo(root);
      return sendJson(res, 200, {
        valid: true,
        repoRoot: root,
        repoName: path.basename(root),
        branch: branchInfo.branch,
      });
    }

    // Project History & Tabs persistence
    if (pathname === '/api/projects/history') {
      const historyFile = path.join(os.homedir(), '.webstorm_git_projects.json');
      if (req.method === 'GET') {
        try {
          if (fs.existsSync(historyFile)) {
            const raw = await fs.promises.readFile(historyFile, 'utf8');
            return sendJson(res, 200, JSON.parse(raw));
          }
        } catch (e) {
          console.error('Error reading history file:', e);
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
              current = JSON.parse(raw);
            } catch {}
          }
          const updated = {
            projects: Array.isArray(body.projects) ? body.projects : current.projects,
            recent: Array.isArray(body.recent) ? body.recent : current.recent,
          };
          await fs.promises.writeFile(historyFile, JSON.stringify(updated, null, 2), 'utf8');
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
        exec("osascript -e 'POSIX path of (choose folder with prompt \"Select Git Repository\")'", (err, stdout) => {
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

    if (pathname === '/api/repo' && req.method === 'GET') {
      const branchInfo = await getBranchInfo(currentRepo);
      return sendJson(res, 200, {
        repoRoot: currentRepo,
        repoName: path.basename(currentRepo),
        branch: branchInfo.branch,
      });
    }

    if (pathname === '/api/repo/set' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const newRoot = await getRepoRoot(body.path);
      if (!newRoot) {
        return sendJson(res, 400, { error: 'Not a valid git repository' });
      }
      defaultRepoRoot = newRoot;
      const branchInfo = await getBranchInfo(defaultRepoRoot);
      return sendJson(res, 200, {
        repoRoot: defaultRepoRoot,
        repoName: path.basename(defaultRepoRoot),
        branch: branchInfo.branch,
      });
    }

    // File Explorer: list directory entries with git status
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
      const gitFiles = await getGitStatus(currentRepo);
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
      const files = await getGitStatus(currentRepo);
      const changelists = await changelistMgr.syncWithStatus(files);
      const branchInfo = await getBranchInfo(currentRepo);

      return sendJson(res, 200, {
        files,
        changelists,
        branch: branchInfo.branch,
        repoRoot: currentRepo,
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
