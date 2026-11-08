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
  Copy,
  FolderSearch,
  GitCompare,
  X,
  Search,
} from 'lucide-react';
import { FsEntry, GitFileStatus } from '../types';
import { fetchDirEntries, openInFinder, compareTwoFiles, getActiveRepoRoot } from '../api';

interface FileExplorerProps {
  repoName: string;
  repoRoot?: string;
  selectedPath: string | null;
  onSelectFile: (path: string, status?: GitFileStatus) => void;
  onCompareFiles?: (file1: string, file2: string) => void;
  onCompareDirectories?: (dir1: string, dir2: string) => void;
  onFindInPath?: (scopePath: string) => void;
}

interface DirCache {
  [subPath: string]: FsEntry[];
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  name: string;
  isDir: boolean;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  repoName,
  repoRoot,
  selectedPath,
  onSelectFile,
  onCompareFiles,
  onCompareDirectories,
  onFindInPath,
}) => {
  const [cache, setCache] = useState<DirCache>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['']));
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Sync selectedPath into selectedFiles if selectedFiles is empty
  useEffect(() => {
    if (selectedPath && selectedFiles.length === 0 && selectedFolders.length === 0) {
      setSelectedFiles([selectedPath]);
    }
  }, [selectedPath]);

  // Instantly prefetch compare content in background as soon as 2 files are selected
  useEffect(() => {
    if (selectedFiles.length === 2) {
      compareTwoFiles(selectedFiles[0], selectedFiles[1]).catch(() => {});
    }
  }, [selectedFiles]);

  const handleFileClick = (e: React.MouseEvent, filePath: string, status?: GitFileStatus) => {
    setSelectedFolders([]);
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setSelectedFiles((prev) => {
        if (prev.includes(filePath)) {
          return prev.filter((p) => p !== filePath);
        }
        if (prev.length >= 2) {
          // Keep 2 files selected, replacing the 2nd one
          return [prev[0], filePath];
        }
        return [...prev, filePath];
      });
    } else {
      setSelectedFiles([filePath]);
      onSelectFile(filePath, status);
    }
  };

  const handleFolderClick = (e: React.MouseEvent, folderPath: string) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      setSelectedFiles([]);
      setSelectedFolders((prev) => {
        if (prev.includes(folderPath)) {
          return prev.filter((p) => p !== folderPath);
        }
        if (prev.length >= 2) {
          return [prev[0], folderPath];
        }
        return [...prev, folderPath];
      });
    } else {
      toggleDirectory(folderPath);
      setSelectedFolders([folderPath]);
      setSelectedFiles([]);
    }
  };

  // Close context menu on any outside click or context menu invocation
  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, []);

  // Load a directory if not cached
  const loadDirectory = useCallback(async (dirPath: string) => {
    const targetRoot = repoRoot || getActiveRepoRoot();
    if (!targetRoot) return;
    setLoadingDirs((prev) => new Set(prev).add(dirPath));
    try {
      const entries = await fetchDirEntries(dirPath, targetRoot);
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
  }, [repoRoot]);

  // Initial root load or project switch
  useEffect(() => {
    setCache({});
    setExpandedDirs(new Set(['']));
    setSelectedFiles([]);
    setSelectedFolders([]);
    if (repoRoot || getActiveRepoRoot()) {
      loadDirectory('');
    }
  }, [repoRoot, repoName, loadDirectory]);

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
    Array.from(expandedDirs).forEach((d) => loadDirectory(d));
  };

  const handleContextMenu = (e: React.MouseEvent, path: string, name: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    if (isDir) {
      if (!selectedFolders.includes(path)) {
        if (selectedFolders.length === 1) {
          // Keep selected folder so user can compare with it
        } else {
          setSelectedFolders([path]);
          setSelectedFiles([]);
        }
      }
    } else {
      if (!selectedFiles.includes(path)) {
        if (selectedFiles.length === 1) {
          // Keep selected file so user can compare with it
        } else {
          setSelectedFiles([path]);
          setSelectedFolders([]);
        }
      }
    }
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 180);
    setContextMenu({ x, y, path, name, isDir });
  };

  const handleOpenInFinder = async (path: string) => {
    setContextMenu(null);
    try {
      await openInFinder(path);
    } catch (err: any) {
      alert(err.message || 'Failed to open in Finder');
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setContextMenu(null);
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
        const isMultiSelectedFolder = selectedFolders.includes(entry.path);
        const folderSelectIndex = selectedFolders.indexOf(entry.path);

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
                background: isMultiSelectedFolder ? 'var(--jb-selection-bg)' : 'transparent',
                borderLeft: isMultiSelectedFolder && selectedFolders.length === 2 ? '2px solid var(--jb-accent)' : '2px solid transparent',
              }}
              onClick={(e) => handleFolderClick(e, entry.path)}
              onContextMenu={(e) => handleContextMenu(e, entry.path, entry.name, true)}
              className="jb-tree-row"
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  toggleDirectory(entry.path);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', marginRight: '4px' }}
              >
                {isExpanded ? (
                  <ChevronDown size={12} style={{ color: 'var(--jb-text-dim)', flexShrink: 0 }} />
                ) : (
                  <ChevronRight size={12} style={{ color: 'var(--jb-text-dim)', flexShrink: 0 }} />
                )}
              </span>

              {isExpanded ? (
                <FolderOpen size={13} style={{ marginRight: '6px', color: '#e5ba64', flexShrink: 0 }} />
              ) : (
                <Folder size={13} style={{ marginRight: '6px', color: '#e5ba64', flexShrink: 0 }} />
              )}

              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                {entry.name}
              </span>

              {isMultiSelectedFolder && selectedFolders.length > 1 && (
                <span
                  style={{
                    fontSize: '9px',
                    background: 'var(--jb-accent)',
                    color: '#fff',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    marginLeft: '4px',
                    fontWeight: 700,
                    flexShrink: 0,
                    lineHeight: '1',
                  }}
                  title={`Selected for directory comparison (#${folderSelectIndex + 1})`}
                >
                  #{folderSelectIndex + 1}
                </span>
              )}
            </div>

            {isExpanded && renderEntries(entry.path, depth + 1)}
          </div>
        );
      } else {
        const isMultiSelected = selectedFiles.includes(entry.path);
        const isSelected = isMultiSelected || (selectedFiles.length === 0 && selectedPath === entry.path);
        const selectIndex = selectedFiles.indexOf(entry.path);

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
              borderLeft: isMultiSelected && selectedFiles.length === 2 ? '2px solid var(--jb-accent)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '12px',
            }}
            onClick={(e) => handleFileClick(e, entry.path, entry.gitStatus)}
            onContextMenu={(e) => handleContextMenu(e, entry.path, entry.name, false)}
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

            {isMultiSelected && selectedFiles.length > 1 && (
              <span
                style={{
                  fontSize: '9px',
                  background: 'var(--jb-accent)',
                  color: '#fff',
                  padding: '1px 5px',
                  borderRadius: '3px',
                  marginLeft: '4px',
                  fontWeight: 700,
                  flexShrink: 0,
                  lineHeight: '1',
                }}
                title={`Selected for comparison (#${selectIndex + 1})`}
              >
                #{selectIndex + 1}
              </span>
            )}

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
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}
      onContextMenu={(e) => handleContextMenu(e, '', repoName, true)}
    >
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
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <FolderTree size={13} color="var(--jb-accent)" />
          <span>Project Files</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {selectedFolders.length === 2 && onCompareDirectories && (
            <button
              className="jb-btn-primary"
              style={{
                height: '20px',
                padding: '0 8px',
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontWeight: 600,
              }}
              onClick={() => onCompareDirectories(selectedFolders[0], selectedFolders[1])}
              title={`Compare ${selectedFolders[0]} and ${selectedFolders[1]}`}
            >
              <GitCompare size={12} />
              <span>Compare Dirs</span>
            </button>
          )}

          {selectedFiles.length === 2 && onCompareFiles && (
            <button
              className="jb-btn-primary"
              style={{
                height: '20px',
                padding: '0 8px',
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontWeight: 600,
              }}
              onClick={() => onCompareFiles(selectedFiles[0], selectedFiles[1])}
              title={`Compare ${selectedFiles[0]} and ${selectedFiles[1]}`}
            >
              <GitCompare size={12} />
              <span>Compare</span>
            </button>
          )}

          {onFindInPath && (
            <button
              className="jb-icon-btn"
              style={{ width: '22px', height: '22px' }}
              onClick={() => onFindInPath('')}
              title="Find in Files (Cmd+Shift+F)"
            >
              <Search size={12} color="var(--jb-accent)" />
            </button>
          )}

          <button
            className="jb-icon-btn"
            style={{ width: '22px', height: '22px' }}
            onClick={handleRefresh}
            title="Refresh File Tree"
          >
            <RotateCw size={11} />
          </button>
        </div>
      </div>

      {/* 2-Folders Compare Banner */}
      {selectedFolders.length === 2 && onCompareDirectories && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '5px 8px',
            background: 'rgba(86, 168, 245, 0.15)',
            borderBottom: '1px solid var(--jb-border)',
            fontSize: '11px',
            color: 'var(--jb-text)',
            gap: '6px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', flex: 1 }}>
            <GitCompare size={12} color="var(--jb-accent)" style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px' }}>
              Compare Dirs: <b>{selectedFolders[0].split('/').pop() || selectedFolders[0] || '.'}</b> ↔ <b>{selectedFolders[1].split('/').pop() || selectedFolders[1] || '.'}</b>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <button
              className="jb-btn-primary"
              style={{ height: '20px', padding: '0 8px', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '3px' }}
              onClick={() => onCompareDirectories(selectedFolders[0], selectedFolders[1])}
            >
              <GitCompare size={10} />
              Compare
            </button>
            <button
              className="jb-icon-btn"
              style={{ width: '18px', height: '18px' }}
              onClick={() => setSelectedFolders([])}
              title="Clear selection"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      {/* 2-Files Compare Banner */}
      {selectedFiles.length === 2 && onCompareFiles && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '5px 8px',
            background: 'rgba(86, 168, 245, 0.15)',
            borderBottom: '1px solid var(--jb-border)',
            fontSize: '11px',
            color: 'var(--jb-text)',
            gap: '6px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', flex: 1 }}>
            <GitCompare size={12} color="var(--jb-accent)" style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px' }}>
              Compare: <b>{selectedFiles[0].split('/').pop()}</b> ↔ <b>{selectedFiles[1].split('/').pop()}</b>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <button
              className="jb-btn-primary"
              style={{ height: '20px', padding: '0 8px', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '3px' }}
              onClick={() => onCompareFiles(selectedFiles[0], selectedFiles[1])}
            >
              <GitCompare size={10} />
              Compare
            </button>
            <button
              className="jb-icon-btn"
              style={{ width: '18px', height: '18px' }}
              onClick={() => setSelectedFiles([])}
              title="Clear selection"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      {/* File Tree content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0' }}>
        {renderEntries('', 0)}
      </div>

      {/* Context Menu for Files and Folders */}
      {contextMenu && (
        <div
          className="jb-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 2 Folders Selected -> Compare Directories */}
          {contextMenu.isDir && selectedFolders.length === 2 && onCompareDirectories && (
            <>
              <div
                className="jb-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  onCompareDirectories(selectedFolders[0], selectedFolders[1]);
                }}
              >
                <GitCompare size={14} color="var(--jb-accent)" />
                <span>Compare Directories</span>
              </div>
              <div className="jb-menu-separator" />
            </>
          )}

          {/* 1 Folder Selected + Right Click another Folder */}
          {contextMenu.isDir && selectedFolders.length === 1 && selectedFolders[0] !== contextMenu.path && onCompareDirectories && (
            <>
              <div
                className="jb-menu-item"
                onClick={() => {
                  const d1 = selectedFolders[0];
                  const d2 = contextMenu.path;
                  setContextMenu(null);
                  setSelectedFolders([d1, d2]);
                  onCompareDirectories(d1, d2);
                }}
              >
                <GitCompare size={14} color="var(--jb-accent)" />
                <span>Compare with "{selectedFolders[0].split('/').pop() || selectedFolders[0] || '.'}"</span>
              </div>
              <div className="jb-menu-separator" />
            </>
          )}

          {/* Select folder for compare */}
          {contextMenu.isDir && (
            <>
              <div
                className="jb-menu-item"
                onClick={() => {
                  setSelectedFolders([contextMenu.path]);
                  setSelectedFiles([]);
                  setContextMenu(null);
                }}
              >
                <GitCompare size={14} />
                <span>Select for Compare</span>
              </div>
              <div className="jb-menu-separator" />
            </>
          )}

          {/* 2 Files Selected */}
          {!contextMenu.isDir && selectedFiles.length === 2 && onCompareFiles && (
            <>
              <div
                className="jb-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  onCompareFiles(selectedFiles[0], selectedFiles[1]);
                }}
              >
                <GitCompare size={14} color="var(--jb-accent)" />
                <span>Compare Selected Files</span>
              </div>
              <div className="jb-menu-separator" />
            </>
          )}

          {/* 1 File Selected + Right Click another File */}
          {!contextMenu.isDir && selectedFiles.length === 1 && selectedFiles[0] !== contextMenu.path && onCompareFiles && (
            <>
              <div
                className="jb-menu-item"
                onClick={() => {
                  const f1 = selectedFiles[0];
                  const f2 = contextMenu.path;
                  setContextMenu(null);
                  setSelectedFiles([f1, f2]);
                  onCompareFiles(f1, f2);
                }}
              >
                <GitCompare size={14} color="var(--jb-accent)" />
                <span>Compare with "{selectedFiles[0].split('/').pop()}"</span>
              </div>
              <div className="jb-menu-separator" />
            </>
          )}

          {/* Select file for compare */}
          {!contextMenu.isDir && (
            <>
              <div
                className="jb-menu-item"
                onClick={() => {
                  setSelectedFiles([contextMenu.path]);
                  setSelectedFolders([]);
                  setContextMenu(null);
                }}
              >
                <GitCompare size={14} />
                <span>Select for Compare</span>
              </div>
              <div className="jb-menu-separator" />
            </>
          )}

          {onFindInPath && (
            <>
              <div
                className="jb-menu-item"
                onClick={() => {
                  const scope = contextMenu.isDir ? contextMenu.path : '';
                  setContextMenu(null);
                  onFindInPath(scope);
                }}
              >
                <Search size={14} color="var(--jb-accent)" />
                <span>{contextMenu.isDir ? 'Find in Path...' : 'Find in Files...'}</span>
                <span style={{ fontSize: '10px', color: 'var(--jb-text-dim)', marginLeft: 'auto' }}>⇧⌘F</span>
              </div>
              <div className="jb-menu-separator" />
            </>
          )}

          <div
            className="jb-menu-item"
            onClick={() => handleOpenInFinder(contextMenu.path)}
            title={contextMenu.isDir ? 'Open folder in Finder' : 'Reveal and select file in Finder'}
          >
            <FolderSearch size={14} color="var(--jb-accent)" />
            <span>{contextMenu.isDir ? 'Open in Finder' : 'Reveal in Finder'}</span>
          </div>

          <div className="jb-menu-separator" />

          <div
            className="jb-menu-item"
            onClick={() => handleCopy(contextMenu.path || '.')}
          >
            <Copy size={13} />
            <span>Copy Relative Path</span>
          </div>

          <div
            className="jb-menu-item"
            onClick={() => handleCopy(contextMenu.name)}
          >
            <Copy size={13} />
            <span>Copy Name</span>
          </div>
        </div>
      )}
    </div>
  );
};
