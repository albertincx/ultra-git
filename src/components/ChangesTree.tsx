import React, { useState, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  List,
  FolderTree,
  RotateCw,
  Plus,
  Archive,
  ArrowRightLeft,
  Trash2,
  CheckSquare,
  Square,
  MinusSquare,
} from 'lucide-react';
import { GitFile, Changelist, ChangelistState, TreeNode } from '../types';

interface ChangesTreeProps {
  files: GitFile[];
  changelistState: ChangelistState;
  selectedFilePath: string | null;
  onSelectFile: (file: GitFile) => void;
  checkedFiles: Set<string>;
  onToggleCheck: (path: string) => void;
  onToggleCheckAll: (paths: string[], checked: boolean) => void;
  onRefresh: () => void;
  onCreateChangelist: (name: string, comment?: string) => void;
  onMoveFiles: (paths: string[], targetId: string) => void;
  onShelveFiles: (paths: string[]) => void;
  onRollbackFile: (path: string, isUntracked?: boolean) => void;
  onDeleteChangelist: (id: string) => void;
}

export const ChangesTree: React.FC<ChangesTreeProps> = ({
  files,
  changelistState,
  selectedFilePath,
  onSelectFile,
  checkedFiles,
  onToggleCheck,
  onToggleCheckAll,
  onRefresh,
  onCreateChangelist,
  onMoveFiles,
  onShelveFiles,
  onRollbackFile,
  onDeleteChangelist,
}) => {
  const [isTreeView, setIsTreeView] = useState(true);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [collapsedChangelists, setCollapsedChangelists] = useState<Set<string>>(new Set());
  const [showNewClModal, setShowNewClModal] = useState(false);
  const [newClName, setNewClName] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    filePath?: string;
    changelistId?: string;
  } | null>(null);

  // Map files by path for fast lookup
  const filesByPath = useMemo(() => {
    const map = new Map<string, GitFile>();
    files.forEach((f) => map.set(f.path, f));
    return map;
  }, [files]);

  // Build directory tree for a list of file paths
  const buildTree = (paths: string[]): TreeNode[] => {
    const rootNodes: TreeNode[] = [];

    for (const p of paths) {
      const parts = p.split('/');
      let currentLevel = rootNodes;
      let curPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        curPath = curPath ? `${curPath}/${part}` : part;
        const isFile = i === parts.length - 1;

        let existing = currentLevel.find((n) => n.name === part);
        if (!existing) {
          existing = {
            name: part,
            path: curPath,
            isDir: !isFile,
            file: isFile ? filesByPath.get(p) : undefined,
            children: isFile ? undefined : [],
          };
          currentLevel.push(existing);
        }
        if (!isFile && existing.children) {
          currentLevel = existing.children;
        }
      }
    }

    // Sort: directories first, then files alphabetically
    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      nodes.forEach((n) => {
        if (n.children) sortNodes(n.children);
      });
    };
    sortNodes(rootNodes);

    return rootNodes;
  };

  const toggleDir = (dirPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const toggleChangelist = (id: string) => {
    setCollapsedChangelists((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getStatusClass = (status?: string) => {
    switch (status) {
      case 'modified': return 'jb-status-modified';
      case 'added': return 'jb-status-added';
      case 'untracked': return 'jb-status-untracked';
      case 'deleted': return 'jb-status-deleted';
      case 'conflict': return 'jb-status-conflict';
      case 'renamed': return 'jb-status-renamed';
      default: return '';
    }
  };

  const renderFileRow = (file: GitFile, indent: number, displayName?: string) => {
    const isSelected = selectedFilePath === file.path;
    const isChecked = checkedFiles.has(file.path);

    return (
      <div
        key={file.path}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '24px',
          paddingLeft: `${indent}px`,
          paddingRight: '8px',
          background: isSelected ? 'var(--jb-selection-bg)' : 'transparent',
          cursor: 'pointer',
          fontSize: '12px',
        }}
        onClick={() => onSelectFile(file)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, filePath: file.path });
        }}
        className="jb-tree-row"
      >
        <span
          style={{ display: 'inline-flex', marginRight: '6px', cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheck(file.path);
          }}
        >
          {isChecked ? (
            <CheckSquare size={13} color="var(--jb-accent)" />
          ) : (
            <Square size={13} color="var(--jb-text-dim)" />
          )}
        </span>

        <File size={13} style={{ marginRight: '6px', color: 'var(--jb-text-muted)' }} />

        <span
          className={getStatusClass(file.status)}
          style={{
            flex: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {displayName || file.path}
        </span>

        <span
          style={{
            fontSize: '10px',
            color: 'var(--jb-text-dim)',
            marginLeft: '6px',
            textTransform: 'uppercase',
          }}
        >
          {file.status[0]}
        </span>
      </div>
    );
  };

  // Recursively collect all file paths under a directory node
  const getDescendantFilePaths = (n: TreeNode): string[] => {
    const result: string[] = [];
    const collect = (curr: TreeNode) => {
      if (!curr.isDir && curr.file) {
        result.push(curr.file.path);
      } else if (curr.children) {
        curr.children.forEach(collect);
      }
    };
    collect(n);
    return result;
  };

  const renderTreeNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isCollapsed = collapsedDirs.has(node.path);

    if (!node.isDir && node.file) {
      return renderFileRow(node.file, depth * 16 + 24, node.name);
    }

    // Directory
    const dirPaths = getDescendantFilePaths(node);
    const checkedCount = dirPaths.filter((p) => checkedFiles.has(p)).length;
    const isAllChecked = dirPaths.length > 0 && checkedCount === dirPaths.length;
    const isPartChecked = checkedCount > 0 && checkedCount < dirPaths.length;

    return (
      <div key={node.path}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '24px',
            paddingLeft: `${depth * 16 + 8}px`,
            paddingRight: '8px',
            cursor: 'pointer',
            fontSize: '12px',
            color: 'var(--jb-text)',
          }}
          onClick={() => toggleDir(node.path)}
        >
          {isCollapsed ? (
            <ChevronRight size={13} style={{ marginRight: '4px', color: 'var(--jb-text-dim)', flexShrink: 0 }} />
          ) : (
            <ChevronDown size={13} style={{ marginRight: '4px', color: 'var(--jb-text-dim)', flexShrink: 0 }} />
          )}

          {/* Folder Checkbox */}
          <span
            style={{ display: 'inline-flex', marginRight: '6px', cursor: 'pointer', flexShrink: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCheckAll(dirPaths, !isAllChecked);
            }}
            title={isAllChecked ? 'Uncheck all files in folder' : 'Check all files in folder'}
          >
            {isAllChecked ? (
              <CheckSquare size={13} color="var(--jb-accent)" />
            ) : isPartChecked ? (
              <MinusSquare size={13} color="var(--jb-accent)" />
            ) : (
              <Square size={13} color="var(--jb-text-dim)" />
            )}
          </span>

          {isCollapsed ? (
            <Folder size={13} style={{ marginRight: '6px', color: '#e5ba64', flexShrink: 0 }} />
          ) : (
            <FolderOpen size={13} style={{ marginRight: '6px', color: '#e5ba64', flexShrink: 0 }} />
          )}

          <span style={{ fontWeight: 500, marginRight: '6px' }}>{node.name}</span>
          <span style={{ fontSize: '10px', color: 'var(--jb-text-dim)' }}>
            {dirPaths.length}
          </span>
        </div>

        {!isCollapsed && node.children && (
          <div>{node.children.map((child) => renderTreeNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}
      onClick={() => setContextMenu(null)}
    >
      {/* Changes Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '32px',
          padding: '0 8px',
          background: 'var(--jb-header-bg)',
          borderBottom: '1px solid var(--jb-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button className="jb-icon-btn" onClick={onRefresh} title="Refresh Git Status (F5)">
            <RotateCw size={13} />
          </button>
          <button
            className={`jb-icon-btn ${isTreeView ? 'active' : ''}`}
            onClick={() => setIsTreeView(!isTreeView)}
            title={isTreeView ? 'Switch to Flat View' : 'Switch to Tree View'}
          >
            {isTreeView ? <FolderTree size={13} /> : <List size={13} />}
          </button>
          <button
            className="jb-icon-btn"
            onClick={() => setShowNewClModal(true)}
            title="New Changelist..."
          >
            <Plus size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className="jb-btn-secondary"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            disabled={checkedFiles.size === 0}
            onClick={() => onShelveFiles(Array.from(checkedFiles))}
            title="Shelve selected changes"
          >
            <Archive size={12} />
            Shelve ({checkedFiles.size})
          </button>
        </div>
      </div>

      {/* Changelists Tree Container */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {changelistState.changelists.map((cl) => {
          const isCollapsed = collapsedChangelists.has(cl.id);
          const clFiles = (cl.filePaths || [])
            .map((p) => filesByPath.get(p))
            .filter(Boolean) as GitFile[];

          const allClPaths = clFiles.map((f) => f.path);
          const checkedCount = allClPaths.filter((p) => checkedFiles.has(p)).length;
          const isAllChecked = allClPaths.length > 0 && checkedCount === allClPaths.length;
          const isPartChecked = checkedCount > 0 && checkedCount < allClPaths.length;

          return (
            <div key={cl.id} style={{ marginBottom: '8px' }}>
              {/* Changelist Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: '26px',
                  padding: '0 8px',
                  background: '#232529',
                  borderTop: '1px solid rgba(255, 255, 255, 0.04)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
                onClick={() => toggleChangelist(cl.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, changelistId: cl.id });
                }}
              >
                {/* Expand / Collapse */}
                {isCollapsed ? (
                  <ChevronRight size={13} style={{ marginRight: '4px', color: 'var(--jb-text-dim)' }} />
                ) : (
                  <ChevronDown size={13} style={{ marginRight: '4px', color: 'var(--jb-text-dim)' }} />
                )}

                {/* Checkbox for entire changelist */}
                <span
                  style={{ display: 'inline-flex', marginRight: '6px', cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCheckAll(allClPaths, !isAllChecked);
                  }}
                >
                  {isAllChecked ? (
                    <CheckSquare size={13} color="var(--jb-accent)" />
                  ) : isPartChecked ? (
                    <MinusSquare size={13} color="var(--jb-accent)" />
                  ) : (
                    <Square size={13} color="var(--jb-text-dim)" />
                  )}
                </span>

                <span style={{ fontWeight: 600, color: 'var(--jb-text)', marginRight: '6px' }}>
                  {cl.name}
                </span>

                {cl.isDefault && (
                  <span
                    style={{
                      fontSize: '10px',
                      color: 'var(--jb-text-dim)',
                      marginRight: '6px',
                    }}
                  >
                    (active)
                  </span>
                )}

                <span style={{ fontSize: '11px', color: 'var(--jb-text-dim)' }}>
                  {clFiles.length} file{clFiles.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Files in Changelist */}
              {!isCollapsed && (
                <div>
                  {clFiles.length === 0 ? (
                    <div
                      style={{
                        padding: '6px 28px',
                        fontSize: '11px',
                        color: 'var(--jb-text-dim)',
                        fontStyle: 'italic',
                      }}
                    >
                      No changes
                    </div>
                  ) : isTreeView ? (
                    buildTree(allClPaths).map((node) => renderTreeNode(node, 0))
                  ) : (
                    clFiles.map((file) => renderFileRow(file, 28))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* New Changelist Modal */}
      {showNewClModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setShowNewClModal(false)}
        >
          <div
            style={{
              background: 'var(--jb-panel-bg)',
              border: '1px solid var(--jb-border)',
              borderRadius: '6px',
              width: '320px',
              padding: '16px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ marginBottom: '12px', fontSize: '13px' }}>New Changelist</h4>
            <input
              type="text"
              className="jb-input"
              style={{ width: '100%', marginBottom: '12px' }}
              placeholder="Name..."
              value={newClName}
              autoFocus
              onChange={(e) => setNewClName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newClName.trim()) {
                  onCreateChangelist(newClName.trim());
                  setShowNewClModal(false);
                  setNewClName('');
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="jb-btn-secondary" onClick={() => setShowNewClModal(false)}>
                Cancel
              </button>
              <button
                className="jb-btn-primary"
                disabled={!newClName.trim()}
                onClick={() => {
                  onCreateChangelist(newClName.trim());
                  setShowNewClModal(false);
                  setNewClName('');
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: '#2b2d30',
            border: '1px solid var(--jb-border)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            borderRadius: '4px',
            padding: '4px 0',
            zIndex: 1000,
            fontSize: '12px',
            minWidth: '180px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.filePath && (
            <>
              <div
                style={{
                  padding: '6px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                className="jb-menu-item"
                onClick={() => {
                  const f = filesByPath.get(contextMenu.filePath!);
                  if (f) onSelectFile(f);
                  setContextMenu(null);
                }}
              >
                Show Diff
              </div>

              {/* Move to another changelist */}
              <div
                style={{
                  padding: '6px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                className="jb-menu-item"
                onClick={() => {
                  const otherCl = changelistState.changelists.find((c) =>
                    !c.filePaths.includes(contextMenu.filePath!)
                  );
                  if (otherCl) {
                    onMoveFiles([contextMenu.filePath!], otherCl.id);
                  }
                  setContextMenu(null);
                }}
              >
                <ArrowRightLeft size={13} />
                Move to Changelist...
              </div>

              <div
                style={{
                  padding: '6px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                className="jb-menu-item"
                onClick={() => {
                  onShelveFiles([contextMenu.filePath!]);
                  setContextMenu(null);
                }}
              >
                <Archive size={13} />
                Shelve Changes...
              </div>

              <div
                style={{
                  padding: '6px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--jb-git-conflict)',
                }}
                className="jb-menu-item"
                onClick={() => {
                  const f = filesByPath.get(contextMenu.filePath!);
                  onRollbackFile(contextMenu.filePath!, f?.status === 'untracked');
                  setContextMenu(null);
                }}
              >
                <Trash2 size={13} />
                Rollback (Revert)...
              </div>
            </>
          )}

          {contextMenu.changelistId && (
            <div
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--jb-git-conflict)',
              }}
              className="jb-menu-item"
              onClick={() => {
                onDeleteChangelist(contextMenu.changelistId!);
                setContextMenu(null);
              }}
            >
              <Trash2 size={13} />
              Delete Changelist
            </div>
          )}
        </div>
      )}
    </div>
  );
};
