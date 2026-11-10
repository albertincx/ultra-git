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
  getActiveRepoRoot,
  validateRepoPath,
  fetchProjectHistory,
  saveProjectHistory,
  initGitRepoApi,
  compareTwoFiles,
  openNativeTerminal,
} from './api';
import { GitFile, ChangelistState, ShelfItem, ProjectTab, GitFileStatus } from './types';
import { ProjectTabs } from './components/ProjectTabs';
import { FileExplorer } from './components/FileExplorer';
import { ChangesTree } from './components/ChangesTree';
import { ShelfView } from './components/ShelfView';
import { CommitBar } from './components/CommitBar';
import { DiffEditor } from './components/DiffEditor';
import { BottomBar } from './components/BottomBar';
import { DirectoryCompareModal } from './components/DirectoryCompareModal';
import { FindToolWindow } from './components/FindToolWindow';
import { Layers, Archive, FileText } from 'lucide-react';

const SAVED_PROJECTS_KEY = 'ultra_git_projects';
const ACTIVE_PROJECT_KEY = 'ultra_active_project_id';

export const App: React.FC = () => {
  // Project Tabs State
  const [projects, setProjects] = useState<ProjectTab[]>(() => {
    try {
      const saved = localStorage.getItem(SAVED_PROJECTS_KEY);
      if (saved) return JSON.parse(saved);
    } catch { }
    return [];
  });
  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_PROJECT_KEY) || '';
    } catch { }
    return '';
  });

  // Active Project Reference (guaranteed to match activeProjectId, with fallback to first tab)
  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0] || null;

  // Synchronously ensure activeRepoRoot in api.ts is immediately set for activeProject
  if (activeProject?.repoRoot && getActiveRepoRoot() !== activeProject.repoRoot) {
    setActiveRepoRoot(activeProject.repoRoot);
  }

  // Tab: Local Changes | Shelf
  const [activeTab, setActiveTab] = useState<'changes' | 'shelf'>('changes');

  // Hide non-git (untracked) files
  const [hideNonGit, setHideNonGit] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ultra_hide_non_git') === 'true';
    } catch { }
    return false;
  });

  const handleToggleHideNonGit = useCallback(() => {
    setHideNonGit((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ultra_hide_non_git', String(next));
      } catch { }
      return next;
    });
  }, []);

  // File Explorer vs Local Changes Split
  const [explorerHeight, setExplorerHeight] = useState(250);
  const isDraggingHorizontal = useRef(false);

  // Git & Changelists
  const [files, setFiles] = useState<GitFile[]>([]);
  const displayedFiles = hideNonGit ? files.filter((f) => f.status !== 'untracked') : files;
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
  const [editorMode, setEditorMode] = useState<'diff' | 'editor'>('diff');
  const [compareInfo, setCompareInfo] = useState<{
    title: string;
    leftLabel: string;
    rightLabel: string;
  } | null>(null);

  // Directory comparison modal state
  const [compareDirsModal, setCompareDirsModal] = useState<{
    isOpen: boolean;
    dir1: string;
    dir2: string;
  } | null>(null);

  // Splitter state
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const isDraggingSplitter = useRef(false);

  // Find in Files (Bottom Tool Window) state
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findScope, setFindScope] = useState('');
  const [findHeight, setFindHeight] = useState(250);
  const isDraggingFindSplitter = useRef(false);
  const [jumpToLine, setJumpToLine] = useState<{ line: number; column?: number; length?: number } | null>(null);

  const handleFindSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingFindSplitter.current = true;
    const startY = e.clientY;
    const startHeight = findHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingFindSplitter.current) return;
      const deltaY = startY - moveEvent.clientY;
      const nextH = Math.max(120, Math.min(window.innerHeight * 0.75, startHeight + deltaY));
      setFindHeight(nextH);
    };

    const onMouseUp = () => {
      isDraggingFindSplitter.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleOpenSearchMatch = (filePath: string, line: number, column: number, length: number) => {
    handleSelectExplorerFile(filePath);
    setJumpToLine({ line, column, length });
  };

  // Shortcut to open Find in Files (Cmd+Shift+F or Ctrl+Shift+F)
  useEffect(() => {
    const handleGlobalFind = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setIsFindOpen(true);
        const sel = window.getSelection()?.toString();
        if (sel && sel.trim()) {
          setFindQuery(sel.trim());
        }
      }
    };
    window.addEventListener('keydown', handleGlobalFind);
    return () => window.removeEventListener('keydown', handleGlobalFind);
  }, []);

  // Native macOS Terminal launcher
  const handleOpenTerminal = useCallback(() => {
    openNativeTerminal(activeProject?.repoRoot);
  }, [activeProject]);

  // Shortcut to open native macOS terminal (Ctrl+` or Alt+F12)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === '`') || (e.altKey && e.key === 'F12')) {
        e.preventDefault();
        handleOpenTerminal();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleOpenTerminal]);

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
      if (activeProjectId) {
        localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
      }
      saveProjectHistory({
        projects,
        activeProjectId,
        activeRepoRoot: activeProject?.repoRoot,
      });
    }
  }, [projects, activeProjectId, activeProject]);

  // Load Diff for a file
  const loadDiff = useCallback(async (filePath: string) => {
    try {
      const content = await fetchFileContent(filePath);
      setDiffContent({ original: content.original, modified: content.modified });
    } catch (e) {
      console.error('Error loading diff:', e);
    }
  }, []);

  // Load Status for active project
  const loadStatus = useCallback(async (targetProj?: ProjectTab | null | unknown) => {
    const proj = (targetProj && typeof targetProj === 'object' && 'repoRoot' in targetProj && typeof (targetProj as any).repoRoot === 'string')
      ? (targetProj as ProjectTab)
      : activeProject;
    if (!proj || !proj.repoRoot) return;
    try {
      setActiveRepoRoot(proj.repoRoot);
      const [status, shelf] = await Promise.all([
        fetchGitStatus(proj.repoRoot),
        fetchShelfList(proj.repoRoot),
      ]);

      if (
        (status.branch && status.branch !== proj.branch) ||
        (status.isGit !== undefined && status.isGit !== proj.isGit)
      ) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === proj.id
              ? { ...p, branch: status.branch || p.branch, isGit: status.isGit !== undefined ? status.isGit : p.isGit }
              : p
          )
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
  }, [activeProject, selectedFile, loadDiff]);

  // Centralized project switcher that immediately syncs API, storage, and UI states
  const handleSelectProject = useCallback((id: string) => {
    const target = projects.find((p) => p.id === id);
    if (!target) return;

    setActiveRepoRoot(target.repoRoot);
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);

    // If clicking on already active project tab, do not clear files or reset editor!
    // Simply refresh git status:
    if (id === activeProjectId) {
      loadStatus(target);
      return;
    }

    setActiveProjectId(id);
    setSelectedFile(null);
    setDiffContent(null);
    setCompareInfo(null);
    loadStatus(target);
    saveProjectHistory({
      projects,
      activeProjectId: id,
      activeRepoRoot: target.repoRoot,
    });
  }, [projects, activeProjectId, loadStatus]);

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

        // Determine which project should be active (respect saved user selection)
        const savedActiveId = localStorage.getItem(ACTIVE_PROJECT_KEY);
        let targetProj = combined.find((p) => p.id === savedActiveId);

        if (!targetProj && history?.activeProjectId) {
          targetProj = combined.find((p) => p.id === history.activeProjectId);
        }
        if (!targetProj && history?.activeRepoRoot) {
          targetProj = combined.find((p) => p.repoRoot === history.activeRepoRoot);
        }

        if (!targetProj && info && info.repoRoot) {
          const matchIndex = combined.findIndex((p) => p.repoRoot === info.repoRoot);
          if (matchIndex >= 0) {
            combined[matchIndex] = {
              ...combined[matchIndex],
              branch: info.branch || combined[matchIndex].branch,
              repoName: info.repoName || combined[matchIndex].repoName,
              isGit: info.isGit,
            };
            targetProj = combined[matchIndex];
          } else {
            const newTab: ProjectTab = {
              id: 'proj_' + Date.now(),
              repoRoot: info.repoRoot,
              repoName: info.repoName,
              branch: info.branch,
              isGit: info.isGit,
            };
            combined = [...combined, newTab];
            targetProj = newTab;
          }
        }

        if (!targetProj && combined.length > 0) {
          targetProj = combined[combined.length - 1] || combined[0];
        }

        if (targetProj) {
          setActiveProjectId(targetProj.id);
          setActiveRepoRoot(targetProj.repoRoot);
          localStorage.setItem(ACTIVE_PROJECT_KEY, targetProj.id);
          await loadStatus(targetProj);
        }

        setProjects(combined);
        if (combined.length > 0) {
          localStorage.setItem(SAVED_PROJECTS_KEY, JSON.stringify(combined));
          saveProjectHistory({
            projects: combined,
            activeProjectId: targetProj?.id,
            activeRepoRoot: targetProj?.repoRoot,
          });
        }
      } catch (e) {
        console.error('Failed to init repository:', e);
      }
    };
    initDefault();
  }, []);

  useEffect(() => {
    if (activeProject) {
      setActiveRepoRoot(activeProject.repoRoot);
      localStorage.setItem(ACTIVE_PROJECT_KEY, activeProject.id);
      loadStatus(activeProject);
    }
  }, [activeProjectId]);

  // Add Project Tab
  const handleAddProject = async (pathToAdd: string) => {
    const validated = await validateRepoPath(pathToAdd);
    const existing = projects.find((p) => p.repoRoot === validated.repoRoot);
    if (existing) {
      handleSelectProject(existing.id);
      return;
    }

    const newTab: ProjectTab = {
      id: 'proj_' + Date.now(),
      repoRoot: validated.repoRoot,
      repoName: validated.repoName,
      branch: validated.branch,
      isGit: validated.isGit,
    };

    const nextProjects = [...projects, newTab];
    setProjects(nextProjects);
    setActiveRepoRoot(newTab.repoRoot);
    localStorage.setItem(ACTIVE_PROJECT_KEY, newTab.id);
    setActiveProjectId(newTab.id);
    setSelectedFile(null);
    setDiffContent(null);
    setCompareInfo(null);
    loadStatus(newTab);
  };

  // Close Project Tab
  const handleCloseProject = (idToClose: string) => {
    if (projects.length <= 1) return;
    const index = projects.findIndex((p) => p.id === idToClose);
    const nextProjects = projects.filter((p) => p.id !== idToClose);
    setProjects(nextProjects);

    if (activeProjectId === idToClose) {
      const nextActive = nextProjects[Math.max(0, index - 1)];
      if (nextActive) {
        handleSelectProject(nextActive.id);
      }
    }
  };

  // Initialize Git repository for active project
  const handleInitGit = async () => {
    const currentRoot = (activeProject?.repoRoot || getActiveRepoRoot() || '').trim().replace(/\/+$/, '');
    if (
      currentRoot === '/tmp/ultraEmptyDir' ||
      currentRoot === '/private/tmp/ultraEmptyDir' ||
      currentRoot.endsWith('/ultraEmptyDir')
    ) {
      return;
    }
    try {
      const res = await initGitRepoApi();
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProjectId
            ? { ...p, branch: res.branch, isGit: true }
            : p
        )
      );
      await loadStatus();
    } catch (e: any) {
      alert(e.message || 'Failed to initialize Git repository');
    }
  };


  const handleSelectFile = (file: GitFile) => {
    setEditorMode('diff');
    setCompareInfo(null);
    setSelectedFile(file);
    loadDiff(file.path);
  };

  // Select file from File Explorer
  const handleSelectExplorerFile = (filePath: string, status?: GitFileStatus) => {
    setEditorMode('editor');
    setCompareInfo(null);
    const existing = files.find((f) => f.path === filePath);
    if (existing) {
      setSelectedFile(existing);
      loadDiff(filePath);
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

  // Compare two arbitrary files from File Explorer
  const handleCompareFiles = async (file1: string, file2: string) => {
    try {
      const data = await compareTwoFiles(file1, file2);
      setEditorMode('diff');
      setDiffContent({ original: data.content1, modified: data.content2 });
      setCompareInfo({
        title: `${file1} ↔ ${file2}`,
        leftLabel: file1,
        rightLabel: file2,
      });
      const compareFile: GitFile = {
        path: file2,
        origPath: file1,
        status: 'modified',
        staged: false,
        workTreeStatus: '',
        indexStatus: '',
      };
      setSelectedFile(compareFile);
    } catch (e: any) {
      alert(e.message || 'Failed to compare files');
    }
  };

  // Compare two directories from File Explorer
  const handleCompareDirectories = (dir1: string, dir2: string) => {
    setCompareDirsModal({ isOpen: true, dir1, dir2 });
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
  // console.log(activeProject)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
      {/* ultra Project Tabs Top Header */}
      <ProjectTabs
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
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
              key={activeProject?.id || activeProject?.repoRoot || 'no-proj'}
              repoName={activeProject?.repoName || 'Project'}
              repoRoot={activeProject?.repoRoot || ''}
              selectedPath={selectedFile?.path || null}
              onSelectFile={handleSelectExplorerFile}
              onCompareFiles={handleCompareFiles}
              onCompareDirectories={handleCompareDirectories}
              onFindInPath={(scopePath) => {
                setIsFindOpen(true);
                setFindScope(scopePath);
              }}
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
                Local Changes ({displayedFiles.length})
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
                      onRefresh={() => loadStatus()}
                      onCreateChangelist={handleCreateChangelist}
                      onMoveFiles={handleMoveFiles}
                      onShelveFiles={handleOpenShelveDialog}
                      onRollbackFile={handleRollback}
                      onDeleteChangelist={handleDeleteChangelist}
                      isGit={activeProject?.isGit !== false}
                      onInitGit={handleInitGit}
                      hideNonGit={hideNonGit}
                      onToggleHideNonGit={handleToggleHideNonGit}
                      repoRoot={activeProject?.repoRoot}
                    />
                  </div>
                  {activeProject?.isGit !== false && (
                    <CommitBar
                      checkedCount={checkedFiles.size}
                      onCommit={handleCommit}
                    />
                  )}
                </>
              ) : (
                <ShelfView
                  shelfItems={shelfItems}
                  selectedShelfId={selectedShelfId}
                  onSelectShelf={setSelectedShelfId}
                  onUnshelve={handleUnshelve}
                  onDeleteShelf={handleDeleteShelf}
                  onSelectShelfFile={(shelfId, filePath) => {
                    setEditorMode('diff');
                    const dummyFile: GitFile = {
                      path: filePath,
                      status: 'modified',
                      staged: false,
                      workTreeStatus: '',
                      indexStatus: '',
                    };
                    setSelectedFile(dummyFile);
                    loadDiff(filePath);
                  }}
                  onRefresh={() => loadStatus()}
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
              mode={editorMode}
              onToggleMode={() => setEditorMode((prev) => (prev === 'diff' ? 'editor' : 'diff'))}
              onSaved={() => loadStatus()}
              onRollback={() => handleRollback(selectedFile.path, selectedFile.status === 'untracked')}
              compareTitle={compareInfo?.title}
              leftLabel={compareInfo?.leftLabel}
              rightLabel={compareInfo?.rightLabel}
              jumpToLine={jumpToLine}
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

      {/* Resizable Bottom Tool Window: Find in Files (WebStorm style) */}
      {isFindOpen && (
        <div
          className="jb-resizer-horizontal"
          onMouseDown={handleFindSplitterMouseDown}
          title="Drag to resize Find tool window"
        />
      )}
      {isFindOpen && (
        <div style={{ height: `${findHeight}px`, minHeight: '120px', maxHeight: '75vh', flexShrink: 0, overflow: 'hidden' }}>
          <FindToolWindow
            isOpen={isFindOpen}
            onClose={() => setIsFindOpen(false)}
            activeRepoRoot={activeProject?.repoRoot}
            repoName={activeProject?.repoName}
            initialQuery={findQuery}
            initialScope={findScope}
            onOpenMatch={handleOpenSearchMatch}
          />
        </div>
      )}

      {/* JetBrains-style Bottom Status Bar */}
      <BottomBar
        onOpenTerminal={handleOpenTerminal}
        onToggleFind={() => setIsFindOpen((prev) => !prev)}
        isFindOpen={isFindOpen}
        activeProject={activeProject || undefined}
        modifiedCount={displayedFiles.length}
      />

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

      {/* WebStorm Style Directory Compare Modal */}
      {compareDirsModal && compareDirsModal.isOpen && (
        <DirectoryCompareModal
          isOpen={compareDirsModal.isOpen}
          dir1={compareDirsModal.dir1}
          dir2={compareDirsModal.dir2}
          onClose={() => setCompareDirsModal(null)}
        />
      )}
    </div>
  );
};
