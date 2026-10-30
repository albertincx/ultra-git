import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchRepoInfo,
  fetchGitStatus,
  fetchFileContent,
  commitChanges,
  createChangelist,
  moveFilesToChangelist,
  deleteChangelist,
  fetchShelfList,
  createShelf,
  unshelve,
  deleteShelf,
  rollbackFile,
  setActiveRepoRoot,
  validateRepoPath,
  fetchProjectHistory,
  saveProjectHistory,
} from './api';
import { GitFile, ChangelistState, ShelfItem, ProjectTab, GitFileStatus } from './types';
import { ProjectTabs } from './components/ProjectTabs';
import { FileExplorer } from './components/FileExplorer';
import { ChangesTree } from './components/ChangesTree';
import { ShelfView } from './components/ShelfView';
import { CommitBar } from './components/CommitBar';
import { DiffEditor } from './components/DiffEditor';
import { Layers, Archive, FileText } from 'lucide-react';

const SAVED_PROJECTS_KEY = 'ultra_git_projects';

export const App: React.FC = () => {
  // Project Tabs State
  const [projects, setProjects] = useState<ProjectTab[]>(() => {
    try {
      const saved = localStorage.getItem(SAVED_PROJECTS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [activeProjectId, setActiveProjectId] = useState<string>('');

  // Tab: Local Changes | Shelf
  const [activeTab, setActiveTab] = useState<'changes' | 'shelf'>('changes');

  // File Explorer vs Local Changes Split
  const [explorerHeight, setExplorerHeight] = useState(250);
  const isDraggingHorizontal = useRef(false);

  // Git & Changelists
  const [files, setFiles] = useState<GitFile[]>([]);
  const [changelistState, setChangelistState] = useState<ChangelistState>({
    activeId: 'default',
    changelists: [],
  });
  const [checkedFiles, setCheckedFiles] = useState<Set<string>>(new Set());

  // Shelf
  const [shelfItems, setShelfItems] = useState<ShelfItem[]>([]);
  const [selectedShelfId, setSelectedShelfId] = useState<string | null>(null);

  // Selected file for Diff
  const [selectedFile, setSelectedFile] = useState<GitFile | null>(null);
  const [diffContent, setDiffContent] = useState<{ original: string; modified: string } | null>(null);

  // Splitter state
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const isDraggingSplitter = useRef(false);

  // Shelve dialog state
  const [shelveDialog, setShelveDialog] = useState<{
    open: boolean;
    files: string[];
    description: string;
    revert: boolean;
  }>({
    open: false,
    files: [],
    description: '',
    revert: true,
  });

  // Save projects to localStorage and backend
  useEffect(() => {
    if (projects.length > 0) {
      localStorage.setItem(SAVED_PROJECTS_KEY, JSON.stringify(projects));
      saveProjectHistory({ projects });
    }
  }, [projects]);

  // Initial Load: initialize default repo tab and sync history
  useEffect(() => {
    const initDefault = async () => {
      try {
        const [info, history] = await Promise.all([
          fetchRepoInfo().catch(() => null),
          fetchProjectHistory().catch(() => null),
        ]);

        let combined: ProjectTab[] = [...projects];
        if (history?.projects && history.projects.length > 0) {
          for (const hp of history.projects) {
            if (!combined.some((p) => p.repoRoot === hp.repoRoot)) {
              combined.push(hp);
            }
          }
        }

        if (info && info.repoRoot) {
          const matchIndex = combined.findIndex((p) => p.repoRoot === info.repoRoot);
          if (matchIndex >= 0) {
            combined[matchIndex] = {
              ...combined[matchIndex],
              branch: info.branch || combined[matchIndex].branch,
              repoName: info.repoName || combined[matchIndex].repoName,
            };
            setActiveProjectId(combined[matchIndex].id);
            setActiveRepoRoot(combined[matchIndex].repoRoot);
          } else {
            const newTab: ProjectTab = {
              id: 'proj_' + Date.now(),
              repoRoot: info.repoRoot,
              repoName: info.repoName,
              branch: info.branch,
            };
            combined = [newTab, ...combined];
            setActiveProjectId(newTab.id);
            setActiveRepoRoot(newTab.repoRoot);
          }
        } else if (combined.length > 0) {
          setActiveProjectId(combined[0].id);
          setActiveRepoRoot(combined[0].repoRoot);
        }

        setProjects(combined);
        if (combined.length > 0) {
          localStorage.setItem(SAVED_PROJECTS_KEY, JSON.stringify(combined));
          saveProjectHistory({ projects: combined });
        }
      } catch (e) {
        console.error('Failed to init repository:', e);
      }
    };
    initDefault();
  }, []);

  // Active Project Reference
  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Load Status for active project
  const loadStatus = useCallback(async () => {
    if (!activeProject) return;
    try {
      setActiveRepoRoot(activeProject.repoRoot);
      const [status, shelf] = await Promise.all([
        fetchGitStatus(),
        fetchShelfList(),
      ]);

      if (status.branch && status.branch !== activeProject.branch) {
        setProjects((prev) =>
          prev.map((p) => (p.id === activeProject.id ? { ...p, branch: status.branch } : p))
        );
      }

      setFiles(status.files);
      setChangelistState(status.changelists);
      setShelfItems(shelf);

      setCheckedFiles((prev) => {
        if (prev.size === 0) {
          return new Set(status.files.map((f) => f.path));
        }
        const currentPaths = new Set(status.files.map((f) => f.path));
        return new Set(Array.from(prev).filter((p) => currentPaths.has(p)));
      });

      if (selectedFile) {
        loadDiff(selectedFile.path);
      }
    } catch (e) {
      console.error('Error loading git status:', e);
    }
  }, [activeProject, selectedFile]);

  useEffect(() => {
    if (activeProject) {
      setActiveRepoRoot(activeProject.repoRoot);
      setSelectedFile(null);
      setDiffContent(null);
      loadStatus();
    }
  }, [activeProjectId]);

  // Add Project Tab
  const handleAddProject = async (pathToAdd: string) => {
    const validated = await validateRepoPath(pathToAdd);
    const existing = projects.find((p) => p.repoRoot === validated.repoRoot);
    if (existing) {
      setActiveProjectId(existing.id);
      return;
    }

    const newTab: ProjectTab = {
      id: 'proj_' + Date.now(),
      repoRoot: validated.repoRoot,
      repoName: validated.repoName,
      branch: validated.branch,
    };

    const nextProjects = [...projects, newTab];
    setProjects(nextProjects);
    setActiveProjectId(newTab.id);
    setActiveRepoRoot(newTab.repoRoot);
  };

  // Close Project Tab
  const handleCloseProject = (idToClose: string) => {
    if (projects.length <= 1) return;
    const index = projects.findIndex((p) => p.id === idToClose);
    const nextProjects = projects.filter((p) => p.id !== idToClose);
    setProjects(nextProjects);

    if (activeProjectId === idToClose) {
      const nextActive = nextProjects[Math.max(0, index - 1)];
      setActiveProjectId(nextActive.id);
      setActiveRepoRoot(nextActive.repoRoot);
    }
  };

  // Load Diff for a file
  const loadDiff = async (filePath: string) => {
    try {
      const content = await fetchFileContent(filePath);
      setDiffContent({ original: content.original, modified: content.modified });
    } catch (e) {
      console.error('Error loading diff:', e);
    }
  };

  const handleSelectFile = (file: GitFile) => {
    setSelectedFile(file);
    loadDiff(file.path);
  };

  // Select file from File Explorer
  const handleSelectExplorerFile = (filePath: string, status?: GitFileStatus) => {
    const existing = files.find((f) => f.path === filePath);
    if (existing) {
      handleSelectFile(existing);
    } else {
      // Unchanged or regular file
      const dummyFile: GitFile = {
        path: filePath,
        status: status || 'modified',
        staged: false,
        workTreeStatus: '',
        indexStatus: '',
      };
      setSelectedFile(dummyFile);
      loadDiff(filePath);
    }
  };

  // Checkbox toggles
  const handleToggleCheck = (path: string) => {
    setCheckedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleToggleCheckAll = (paths: string[], checked: boolean) => {
    setCheckedFiles((prev) => {
      const next = new Set(prev);
      paths.forEach((p) => {
        if (checked) next.add(p);
        else next.delete(p);
      });
      return next;
    });
  };

  // Commit
  const handleCommit = async (message: string) => {
    const selected = Array.from(checkedFiles);
    if (selected.length === 0) return;
    await commitChanges(selected, message);
    await loadStatus();
  };

  // Changelists
  const handleCreateChangelist = async (name: string, comment = '') => {
    const updated = await createChangelist(name, comment);
    setChangelistState(updated);
  };

  const handleMoveFiles = async (paths: string[], targetId: string) => {
    const updated = await moveFilesToChangelist(paths, targetId);
    setChangelistState(updated);
  };

  const handleDeleteChangelist = async (id: string) => {
    const updated = await deleteChangelist(id);
    setChangelistState(updated);
  };

  // Rollback file
  const handleRollback = async (path: string, isUntracked = false) => {
    if (confirm(`Are you sure you want to rollback ${path}? All uncommitted changes will be lost.`)) {
      await rollbackFile(path, isUntracked);
      await loadStatus();
    }
  };

  // Shelve
  const handleOpenShelveDialog = (paths: string[]) => {
    setShelveDialog({
      open: true,
      files: paths,
      description: `Shelved at ${new Date().toLocaleTimeString()}`,
      revert: true,
    });
  };

  const handleConfirmShelve = async () => {
    try {
      await createShelf(shelveDialog.files, shelveDialog.description, shelveDialog.revert);
      setShelveDialog((prev) => ({ ...prev, open: false }));
      await loadStatus();
      setActiveTab('shelf');
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleUnshelve = async (id: string, keepInShelf: boolean) => {
    try {
      await unshelve(id, keepInShelf);
      await loadStatus();
      setActiveTab('changes');
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleDeleteShelf = async (id: string) => {
    if (confirm('Delete this shelf patch?')) {
      const updated = await deleteShelf(id);
      setShelfItems(updated);
    }
  };

  // Splitter dragging
  const handleMouseDown = () => {
    isDraggingSplitter.current = true;
    document.body.style.cursor = 'col-resize';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSplitter.current) {
        const newWidth = Math.max(260, Math.min(e.clientX, window.innerWidth - 300));
        setSidebarWidth(newWidth);
      } else if (isDraggingHorizontal.current) {
        const newHeight = Math.max(100, Math.min(e.clientY - 38, window.innerHeight - 200));
        setExplorerHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      isDraggingSplitter.current = false;
      isDraggingHorizontal.current = false;
      document.body.style.cursor = 'default';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
      {/* ultra Project Tabs Top Header */}
      <ProjectTabs
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={setActiveProjectId}
        onAddProject={handleAddProject}
        onCloseProject={handleCloseProject}
        onRefresh={loadStatus}
      />

      {/* Main Workspace Area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Tool Window */}
        <div
          style={{
            width: `${sidebarWidth}px`,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--jb-panel-bg)',
            borderRight: '1px solid var(--jb-border)',
            flexShrink: 0,
          }}
        >
          {/* Top Pane: File Explorer Tree View */}
          <div style={{ height: `${explorerHeight}px`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <FileExplorer
              repoName={activeProject?.repoName || 'Project'}
              selectedPath={selectedFile?.path || null}
              onSelectFile={handleSelectExplorerFile}
            />
          </div>

          {/* Horizontal Splitter between File Explorer and Local Changes */}
          <div
            className="jb-resizer-horizontal"
            onMouseDown={() => {
              isDraggingHorizontal.current = true;
              document.body.style.cursor = 'row-resize';
            }}
          />

          {/* Bottom Pane: Local Changes & Shelf */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Tabs: Local Changes | Shelf */}
            <div className="jb-tab-bar">
              <div
                className={`jb-tab ${activeTab === 'changes' ? 'active' : ''}`}
                onClick={() => setActiveTab('changes')}
              >
                <Layers size={13} />
                Local Changes ({files.length})
              </div>
              <div
                className={`jb-tab ${activeTab === 'shelf' ? 'active' : ''}`}
                onClick={() => setActiveTab('shelf')}
              >
                <Archive size={13} />
                Shelf ({shelfItems.length})
              </div>
            </div>

            {/* Tab Content */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {activeTab === 'changes' ? (
                <>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <ChangesTree
                      files={files}
                      changelistState={changelistState}
                      selectedFilePath={selectedFile?.path || null}
                      onSelectFile={handleSelectFile}
                      checkedFiles={checkedFiles}
                      onToggleCheck={handleToggleCheck}
                      onToggleCheckAll={handleToggleCheckAll}
                      onRefresh={loadStatus}
                      onCreateChangelist={handleCreateChangelist}
                      onMoveFiles={handleMoveFiles}
                      onShelveFiles={handleOpenShelveDialog}
                      onRollbackFile={handleRollback}
                      onDeleteChangelist={handleDeleteChangelist}
                    />
                  </div>
                  <CommitBar
                    checkedCount={checkedFiles.size}
                    onCommit={handleCommit}
                  />
                </>
              ) : (
                <ShelfView
                  shelfItems={shelfItems}
                  selectedShelfId={selectedShelfId}
                  onSelectShelf={setSelectedShelfId}
                  onUnshelve={handleUnshelve}
                  onDeleteShelf={handleDeleteShelf}
                  onSelectShelfFile={(shelfId, filePath) => {
                    loadDiff(filePath);
                  }}
                  onRefresh={loadStatus}
                />
              )}
            </div>
          </div>
        </div>

        {/* Vertical Resizer Splitter */}
        <div className="jb-resizer" onMouseDown={handleMouseDown} />

        {/* Right Editor: Interactive Diff Viewer */}
        <div style={{ flex: 1, height: '100%', overflow: 'hidden', background: 'var(--jb-bg)' }}>
          {selectedFile && diffContent ? (
            <DiffEditor
              filePath={selectedFile.path}
              fileStatus={selectedFile.status}
              original={diffContent.original}
              modified={diffContent.modified}
              onSaved={loadStatus}
              onRollback={() => handleRollback(selectedFile.path, selectedFile.status === 'untracked')}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--jb-text-dim)',
                gap: '12px',
              }}
            >
              <FileText size={42} strokeWidth={1.2} />
              <div style={{ fontSize: '13px' }}>Select a file in File Explorer or Local Changes to view and edit</div>
              <div style={{ fontSize: '11px', color: 'var(--jb-text-dim)' }}>
                Left: HEAD revision • Right: Local Working Tree (Editable with Cmd+S)
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Shelve Dialog */}
      {shelveDialog.open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
          }}
          onClick={() => setShelveDialog((prev) => ({ ...prev, open: false }))}
        >
          <div
            style={{
              background: 'var(--jb-panel-bg)',
              border: '1px solid var(--jb-border)',
              borderRadius: '6px',
              width: '420px',
              padding: '18px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ marginBottom: '14px', fontSize: '14px', color: '#fff' }}>Shelve Changes</h4>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '11px', color: 'var(--jb-text-muted)', display: 'block', marginBottom: '6px' }}>
                Shelf Description
              </label>
              <input
                type="text"
                className="jb-input"
                style={{ width: '100%' }}
                value={shelveDialog.description}
                autoFocus
                onChange={(e) => setShelveDialog((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  color: 'var(--jb-text)',
                }}
              >
                <input
                  type="checkbox"
                  checked={shelveDialog.revert}
                  onChange={(e) => setShelveDialog((prev) => ({ ...prev, revert: e.target.checked }))}
                />
                Revert working copies of shelved files
              </label>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--jb-text-dim)', marginBottom: '16px' }}>
              Shelving {shelveDialog.files.length} file{shelveDialog.files.length !== 1 ? 's' : ''}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                className="jb-btn-secondary"
                onClick={() => setShelveDialog((prev) => ({ ...prev, open: false }))}
              >
                Cancel
              </button>
              <button className="jb-btn-primary" onClick={handleConfirmShelve}>
                Shelve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
