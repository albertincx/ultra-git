import React, { useState, useEffect } from 'react';
import {
  FolderGit2,
  GitBranch,
  Plus,
  X,
  RotateCw,
  FolderPlus,
  FolderSearch,
  Clock,
  Trash2,
  Copy,
  Sparkles,
} from 'lucide-react';
import { ProjectTab, RecentProject } from '../types';
import { openFolderDialog, fetchProjectHistory, saveProjectHistory, openInFinder } from '../api';
import { UpdateModal } from './UpdateModal';

const RECENT_PROJECTS_KEY = 'ultra_recent_projects';

interface ProjectTabsProps {
  projects: ProjectTab[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onAddProject: (path: string) => Promise<void>;
  onCloseProject: (id: string) => void;
  onRefresh: () => void;
}

export const ProjectTabs: React.FC<ProjectTabsProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject,
  onCloseProject,
  onRefresh,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [addError, setAddError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, []);

  // Recent Projects History (Max 10)
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() => {
    try {
      const saved = localStorage.getItem(RECENT_PROJECTS_KEY) || localStorage.getItem('Ultra_recent_projects');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  // Sync recent projects with server backend
  useEffect(() => {
    fetchProjectHistory().then((history) => {
      if (history?.recent && history.recent.length > 0) {
        setRecentProjects((prev) => {
          if (prev.length === 0) {
            localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(history.recent));
            return history.recent;
          }
          return prev;
        });
      }
    }).catch(() => {});
  }, []);

  // Automatically record active project into recent history
  useEffect(() => {
    const active = projects.find((p) => p.id === activeProjectId);
    if (active) {
      setRecentProjects((prev) => {
        const filtered = prev.filter((p) => p.repoRoot !== active.repoRoot);
        const updated: RecentProject[] = [
          {
            repoRoot: active.repoRoot,
            repoName: active.repoName,
            branch: active.branch,
            lastOpenedAt: Date.now(),
          },
          ...filtered,
        ].slice(0, 10);
        localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated));
        saveProjectHistory({ recent: updated });
        return updated;
      });
    }
  }, [activeProjectId, projects]);

  const removeRecent = (repoRoot: string) => {
    setRecentProjects((prev) => {
      const updated = prev.filter((p) => p.repoRoot !== repoRoot);
      localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated));
      saveProjectHistory({ recent: updated });
      return updated;
    });
  };

  const cleanPath = (raw: string) => {
    let p = raw.trim();
    if (p.startsWith('file://')) {
      try {
        p = decodeURIComponent(p.replace(/^file:\/\//, ''));
      } catch {}
    }
    p = p.replace(/^['"]|['"]$/g, '');
    return p;
  };

  const handleOpenAdd = () => {
    setNewPath('');
    setAddError('');
    setShowAddModal(true);
  };

  const handleBrowseFolder = async () => {
    try {
      const chosen = await openFolderDialog();
      if (chosen) {
        setNewPath(chosen);
        setAddError('');
      }
    } catch (e) {
      console.error('Browse error:', e);
    }
  };

  const handleConfirmAdd = async (targetPath?: string) => {
    const target = cleanPath(targetPath || newPath);
    if (!target) return;
    setIsAdding(true);
    setAddError('');
    try {
      await onAddProject(target);
      setShowAddModal(false);
      setNewPath('');
    } catch (e) {
      setAddError((e as Error).message || 'Failed to open repository');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const droppedPath = (files[0] as any).path || files[0].name;
      if (droppedPath) {
        setNewPath(cleanPath(droppedPath));
        setAddError('');
        return;
      }
    }
    const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
    if (text) {
      setNewPath(cleanPath(text));
      setAddError('');
    }
  };

  const formatRecentTime = (ts: number) => {
    const diffMin = Math.round((Date.now() - ts) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '38px',
          background: '#2b2d30',
          borderBottom: '1px solid var(--jb-border)',
          paddingLeft: '78px', // Space for native macOS traffic light buttons
          paddingRight: '12px',
          WebkitAppRegion: 'drag', // Drag native Mac window from header
          userSelect: 'none',
        } as React.CSSProperties}
      >
        {/* Project Tabs list */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            height: '100%',
            gap: '2px',
            overflowX: 'auto',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          {projects.map((proj) => {
            const isActive = proj.id === activeProjectId;
            return (
              <div
                key={proj.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 12px 6px 10px',
                  height: '32px',
                  background: isActive ? 'var(--jb-bg)' : 'transparent',
                  borderTop: isActive ? '2px solid var(--jb-accent)' : '2px solid transparent',
                  borderRadius: '4px 4px 0 0',
                  color: isActive ? '#fff' : 'var(--jb-text-muted)',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: isActive ? 500 : 400,
                  maxWidth: '220px',
                  transition: 'background 0.1s, color 0.1s',
                  position: 'relative',
                  borderRight: !isActive ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
                }}
                onClick={() => onSelectProject(proj.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({
                    x: Math.min(e.clientX, window.innerWidth - 210),
                    y: Math.min(e.clientY, window.innerHeight - 100),
                    path: proj.repoRoot,
                  });
                }}
                title={`${proj.repoName} — ${proj.repoRoot}`}
                className="jb-project-tab"
              >
                <FolderGit2 size={14} color={isActive ? 'var(--jb-accent)' : 'var(--jb-text-dim)'} />

                <span
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '120px',
                  }}
                >
                  {proj.repoName}
                </span>

                {/* Branch Badge */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    background: isActive ? 'rgba(86, 168, 245, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                    padding: '1px 5px',
                    borderRadius: '8px',
                    fontSize: '10px',
                    color: isActive ? 'var(--jb-git-modified)' : 'var(--jb-text-dim)',
                  }}
                >
                  <GitBranch size={9} />
                  <span>{proj.branch || 'main'}</span>
                </div>

                {/* Close Tab Button */}
                {projects.length > 1 && (
                  <button
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--jb-text-dim)',
                      cursor: 'pointer',
                      padding: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '3px',
                      marginLeft: '2px',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseProject(proj.id);
                    }}
                    title="Close Project Tab"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}

          {/* Add Project Button */}
          <button
            className="jb-icon-btn"
            style={{ width: '26px', height: '26px', marginBottom: '3px', marginLeft: '4px' }}
            onClick={handleOpenAdd}
            title="Open Repository in New Tab..."
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Empty space filler that stays draggable */}
        <div style={{ flex: 1 }} />

        {/* Far right actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          <button
            className="jb-btn-secondary"
            style={{
              height: '24px',
              padding: '0 8px',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
            onClick={() => setShowUpdateModal(true)}
            title="Check for Updates"
          >
            <Sparkles size={12} color="var(--jb-accent)" />
            <span>Check for Updates</span>
          </button>

          <button className="jb-icon-btn" onClick={onRefresh} title="Refresh Git Status (F5)">
            <RotateCw size={13} />
          </button>
        </div>
      </div>

      {/* Add Project Tab Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 300,
          }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            style={{
              background: 'var(--jb-panel-bg)',
              border: `2px ${isDraggingOver ? 'dashed var(--jb-accent)' : 'solid var(--jb-border)'}`,
              borderRadius: '6px',
              width: '500px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              padding: '20px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              transition: 'border-color 0.15s',
            }}
            onClick={(e) => e.stopPropagation()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDrop}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <FolderPlus size={18} color="var(--jb-accent)" />
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>
                Open Repository in New Tab
              </h3>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--jb-text-muted)', marginBottom: '10px' }}>
              Paste path, drag and drop folder, or click <b>Browse...</b>:
            </p>

            <div style={{ display: 'flex', gap: '8px', marginBottom: addError ? '8px' : '14px' }}>
              <input
                type="text"
                className="jb-input"
                style={{ flex: 1 }}
                placeholder="/Users/username/my-project"
                value={newPath}
                autoFocus
                onChange={(e) => setNewPath(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text');
                  if (pasted) {
                    setTimeout(() => setNewPath(cleanPath(pasted)), 0);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmAdd();
                  else if (e.key === 'Escape') setShowAddModal(false);
                }}
              />

              <button
                className="jb-btn-secondary"
                onClick={handleBrowseFolder}
                title="Browse folder in Finder"
                style={{ padding: '0 10px', height: '28px', whiteSpace: 'nowrap' }}
              >
                <FolderSearch size={14} />
                Browse...
              </button>
            </div>

            {addError && (
              <div
                style={{
                  color: 'var(--jb-git-conflict)',
                  fontSize: '11px',
                  marginBottom: '12px',
                }}
              >
                {addError}
              </div>
            )}

            {/* Recent Projects History (Max 10) */}
            {recentProjects.length > 0 && (
              <div
                style={{
                  borderTop: '1px solid var(--jb-border)',
                  paddingTop: '12px',
                  marginBottom: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '8px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--jb-text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Clock size={11} />
                    Recent Projects ({recentProjects.length}/10)
                  </span>
                </div>

                <div
                  style={{
                    maxHeight: '180px',
                    overflowY: 'auto',
                    border: '1px solid var(--jb-border)',
                    borderRadius: '4px',
                    background: 'var(--jb-bg)',
                  }}
                >
                  {recentProjects.map((rec) => (
                    <div
                      key={rec.repoRoot}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                      className="jb-tree-row"
                      onClick={() => handleConfirmAdd(rec.repoRoot)}
                      title={`Click to open: ${rec.repoRoot}`}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                        <FolderGit2 size={13} color="var(--jb-accent)" style={{ flexShrink: 0 }} />
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 500, color: '#fff', marginRight: '6px' }}>
                            {rec.repoName}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--jb-text-dim)' }}>
                            {rec.repoRoot}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '10px', color: 'var(--jb-text-dim)' }}>
                          {formatRecentTime(rec.lastOpenedAt)}
                        </span>
                        <button
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--jb-text-dim)',
                            cursor: 'pointer',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecent(rec.repoRoot);
                          }}
                          title="Remove from history"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button className="jb-btn-secondary" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button
                className="jb-btn-primary"
                disabled={!newPath.trim() || isAdding}
                onClick={() => handleConfirmAdd()}
              >
                {isAdding ? 'Opening...' : 'Open Project'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Context Menu */}
      {contextMenu && (
        <div
          className="jb-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="jb-menu-item"
            onClick={async () => {
              setContextMenu(null);
              try {
                await openInFinder(contextMenu.path);
              } catch (e: any) {
                alert(e.message || 'Failed to open in Finder');
              }
            }}
          >
            <FolderSearch size={14} color="var(--jb-accent)" />
            <span>Open in Finder</span>
          </div>

          <div className="jb-menu-separator" />

          <div
            className="jb-menu-item"
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.path);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>Copy Path</span>
          </div>
        </div>
      )}
      {/* Update Modal */}
      <UpdateModal isOpen={showUpdateModal} onClose={() => setShowUpdateModal(false)} />
    </>
  );
};
