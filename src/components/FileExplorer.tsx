import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  File,
  RotateCw,
  FolderTree,
  FileCode,
  FileJson,
  FileText,
} from 'lucide-react';
import { FsEntry, GitFileStatus } from '../types';
import { fetchDirEntries } from '../api';

interface FileExplorerProps {
  repoName: string;
  selectedPath: string | null;
  onSelectFile: (path: string, status?: GitFileStatus) => void;
}

interface DirCache {
  [subPath: string]: FsEntry[];
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  repoName,
  selectedPath,
  onSelectFile,
}) => {
  const [cache, setCache] = useState<DirCache>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['']));
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  // Load a directory if not cached
  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoadingDirs((prev) => new Set(prev).add(dirPath));
    try {
      const entries = await fetchDirEntries(dirPath);
      setCache((prev) => ({ ...prev, [dirPath]: entries }));
    } catch (e) {
      console.error('Failed to load dir:', dirPath, e);
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  }, []);

  // Initial root load
  useEffect(() => {
    setCache({});
    setExpandedDirs(new Set(['']));
    loadDirectory('');
  }, [repoName, loadDirectory]);

  const toggleDirectory = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
        if (!cache[dirPath]) {
          loadDirectory(dirPath);
        }
      }
      return next;
    });
  };

  const handleRefresh = () => {
    // Reload all currently expanded dirs
    Array.from(expandedDirs).forEach((d) => loadDirectory(d));
  };

  const handleCollapseAll = () => {
    setExpandedDirs(new Set(['']));
  };

  const getStatusColor = (status?: GitFileStatus) => {
    switch (status) {
      case 'modified': return 'var(--jb-git-modified)';
      case 'added': return 'var(--jb-git-added)';
      case 'untracked': return 'var(--jb-git-untracked)';
      case 'deleted': return 'var(--jb-git-deleted)';
      case 'conflict': return 'var(--jb-git-conflict)';
      case 'renamed': return 'var(--jb-git-renamed)';
      default: return 'var(--jb-text)';
    }
  };

  const getFileIcon = (fileName: string) => {
    if (fileName.endsWith('.json')) return <FileJson size={13} color="#e5ba64" />;
    if (fileName.endsWith('.ts') || fileName.endsWith('.tsx') || fileName.endsWith('.js') || fileName.endsWith('.jsx')) {
      return <FileCode size={13} color="var(--jb-accent)" />;
    }
    if (fileName.endsWith('.md') || fileName.endsWith('.txt')) {
      return <FileText size={13} color="var(--jb-text-muted)" />;
    }
    return <File size={13} color="var(--jb-text-muted)" />;
  };

  const renderEntries = (dirPath: string, depth: number) => {
    const entries = cache[dirPath];
    if (!entries) {
      return loadingDirs.has(dirPath) ? (
        <div style={{ paddingLeft: `${depth * 14 + 20}px`, fontSize: '11px', color: 'var(--jb-text-dim)', padding: '2px 0' }}>
          Loading...
        </div>
      ) : null;
    }

    return entries.map((entry) => {
      if (entry.isDir) {
        const isExpanded = expandedDirs.has(entry.path);
        return (
          <div key={entry.path}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                height: '22px',
                paddingLeft: `${depth * 14 + 6}px`,
                paddingRight: '8px',
                cursor: 'pointer',
                fontSize: '12px',
                color: 'var(--jb-text)',
              }}
              onClick={() => toggleDirectory(entry.path)}
              className="jb-tree-row"
            >
              {isExpanded ? (
                <ChevronDown size={12} style={{ marginRight: '4px', color: 'var(--jb-text-dim)', flexShrink: 0 }} />
              ) : (
                <ChevronRight size={12} style={{ marginRight: '4px', color: 'var(--jb-text-dim)', flexShrink: 0 }} />
              )}

              {isExpanded ? (
                <FolderOpen size={13} style={{ marginRight: '6px', color: '#e5ba64', flexShrink: 0 }} />
              ) : (
                <Folder size={13} style={{ marginRight: '6px', color: '#e5ba64', flexShrink: 0 }} />
              )}

              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {entry.name}
              </span>
            </div>

            {isExpanded && renderEntries(entry.path, depth + 1)}
          </div>
        );
      } else {
        const isSelected = selectedPath === entry.path;
        return (
          <div
            key={entry.path}
            style={{
              display: 'flex',
              alignItems: 'center',
              height: '22px',
              paddingLeft: `${depth * 14 + 22}px`,
              paddingRight: '8px',
              background: isSelected ? 'var(--jb-selection-bg)' : 'transparent',
              cursor: 'pointer',
              fontSize: '12px',
            }}
            onClick={() => onSelectFile(entry.path, entry.gitStatus)}
            className="jb-tree-row"
          >
            <span style={{ marginRight: '6px', display: 'inline-flex', flexShrink: 0 }}>
              {getFileIcon(entry.name)}
            </span>

            <span
              style={{
                color: getStatusColor(entry.gitStatus),
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
              }}
            >
              {entry.name}
            </span>

            {entry.gitStatus && (
              <span
                style={{
                  fontSize: '10px',
                  color: getStatusColor(entry.gitStatus),
                  marginLeft: '4px',
                  textTransform: 'uppercase',
                }}
              >
                {entry.gitStatus[0]}
              </span>
            )}
          </div>
        );
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* File Explorer Header Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '28px',
          padding: '0 8px',
          background: 'var(--jb-header-bg)',
          borderBottom: '1px solid var(--jb-border)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--jb-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <FolderTree size={13} color="var(--jb-accent)" />
          <span>Project Files</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button className="jb-icon-btn" style={{ width: '22px', height: '22px' }} onClick={handleRefresh} title="Refresh File Tree">
            <RotateCw size={11} />
          </button>
        </div>
      </div>

      {/* File Tree content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0' }}>
        {renderEntries('', 0)}
      </div>
    </div>
  );
};
