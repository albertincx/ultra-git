import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GitCompare,
  ArrowLeftRight,
  RotateCw,
  X,
  Search,
  Folder,
  FileCode,
  FileJson,
  FileText,
  File,
  ArrowRight,
  ArrowLeft,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Equal,
} from 'lucide-react';
import { DirCompareItem, DirCompareResult } from '../types';
import { compareDirectories, syncDirectoryFile, compareTwoFiles } from '../api';
import { DiffEditor } from './DiffEditor';

interface DirectoryCompareModalProps {
  isOpen: boolean;
  dir1: string;
  dir2: string;
  onClose: () => void;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileName: string) {
  if (fileName.endsWith('.json')) return <FileJson size={13} color="#e5ba64" />;
  if (
    fileName.endsWith('.ts') ||
    fileName.endsWith('.tsx') ||
    fileName.endsWith('.js') ||
    fileName.endsWith('.jsx')
  ) {
    return <FileCode size={13} color="var(--jb-accent)" />;
  }
  if (fileName.endsWith('.md') || fileName.endsWith('.txt')) {
    return <FileText size={13} color="var(--jb-text-muted)" />;
  }
  return <File size={13} color="var(--jb-text-muted)" />;
}

export const DirectoryCompareModal: React.FC<DirectoryCompareModalProps> = ({
  isOpen,
  dir1: initialDir1,
  dir2: initialDir2,
  onClose,
}) => {
  const [leftDir, setLeftDir] = useState(initialDir1);
  const [rightDir, setRightDir] = useState(initialDir2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<DirCompareResult | null>(null);

  // Filters (WebStorm style)
  const [filterDifferent, setFilterDifferent] = useState(true);
  const [filterLeftOnly, setFilterLeftOnly] = useState(true);
  const [filterRightOnly, setFilterRightOnly] = useState(true);
  const [filterSame, setFilterSame] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected file for diff
  const [selectedItem, setSelectedItem] = useState<DirCompareItem | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffContent, setDiffContent] = useState<{ original: string; modified: string } | null>(null);

  // Resizable splitter (vertical split between list and diff)
  const [listHeight, setListHeight] = useState(250);
  const isDraggingSplitter = useRef(false);

  // Toast message
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
  };

  // Sync initial props
  useEffect(() => {
    setLeftDir(initialDir1);
    setRightDir(initialDir2);
  }, [initialDir1, initialDir2]);

  // Load comparison data
  const loadComparison = useCallback(async (d1 = leftDir, d2 = rightDir) => {
    setLoading(true);
    setError(null);
    try {
      const res = await compareDirectories(d1, d2);
      setCompareResult(res);
      // Auto-select first differing or first item if none selected
      if (res.items.length > 0) {
        setSelectedItem((prev) => {
          if (prev && res.items.some((i) => i.relPath === prev.relPath)) {
            return res.items.find((i) => i.relPath === prev.relPath) || res.items[0];
          }
          const firstDiff = res.items.find((i) => i.status === 'different') || res.items[0];
          return firstDiff;
        });
      } else {
        setSelectedItem(null);
        setDiffContent(null);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to compare directories');
    } finally {
      setLoading(false);
    }
  }, [leftDir, rightDir]);

  useEffect(() => {
    if (isOpen) {
      loadComparison();
    }
  }, [isOpen, leftDir, rightDir]);

  // Load diff for currently selected item
  const loadDiff = useCallback(async (item: DirCompareItem | null) => {
    if (!item) {
      setDiffContent(null);
      return;
    }
    setDiffLoading(true);
    try {
      const p1 = leftDir ? `${leftDir}/${item.relPath}` : item.relPath;
      const p2 = rightDir ? `${rightDir}/${item.relPath}` : item.relPath;
      const data = await compareTwoFiles(p1, p2);
      setDiffContent({
        original: data.content1 || '',
        modified: data.content2 || '',
      });
    } catch (e: any) {
      console.error('Failed to load file diff:', e);
      setDiffContent({ original: '', modified: '' });
    } finally {
      setDiffLoading(false);
    }
  }, [leftDir, rightDir]);

  useEffect(() => {
    loadDiff(selectedItem);
  }, [selectedItem, loadDiff]);

  // Swap Left and Right
  const handleSwap = () => {
    const nextLeft = rightDir;
    const nextRight = leftDir;
    setLeftDir(nextLeft);
    setRightDir(nextRight);
    showToast('Swapped Left and Right directories');
  };

  // Sync action (Copy to right, copy to left, delete)
  const handleSyncFile = async (
    item: DirCompareItem,
    action: 'copy_to_right' | 'copy_to_left' | 'delete_left' | 'delete_right'
  ) => {
    try {
      await syncDirectoryFile(leftDir, rightDir, item.relPath, action);
      const actionName =
        action === 'copy_to_right'
          ? `Copied "${item.name}" to right`
          : action === 'copy_to_left'
          ? `Copied "${item.name}" to left`
          : `Deleted "${item.name}"`;
      showToast(actionName);
      await loadComparison();
      await loadDiff(item);
    } catch (e: any) {
      alert(`Action failed: ${e.message}`);
    }
  };

  // Keyboard navigation and Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter items
  const filteredItems = useMemo(() => {
    if (!compareResult) return [];
    return compareResult.items.filter((item) => {
      if (item.status === 'different' && !filterDifferent) return false;
      if (item.status === 'left_only' && !filterLeftOnly) return false;
      if (item.status === 'right_only' && !filterRightOnly) return false;
      if (item.status === 'same' && !filterSame) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        return (
          item.name.toLowerCase().includes(query) ||
          item.relPath.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [compareResult, filterDifferent, filterLeftOnly, filterRightOnly, filterSame, searchQuery]);

  // Handle Splitter drag
  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitter.current = true;
    const startY = e.clientY;
    const startHeight = listHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSplitter.current) return;
      const delta = moveEvent.clientY - startY;
      const newHeight = Math.min(Math.max(120, startHeight + delta), window.innerHeight - 250);
      setListHeight(newHeight);
    };

    const handleMouseUp = () => {
      isDraggingSplitter.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  if (!isOpen) return null;

  const summary = compareResult?.summary || { total: 0, different: 0, leftOnly: 0, rightOnly: 0, same: 0 };

  const leftDisplay = leftDir || '(Project Root)';
  const rightDisplay = rightDir || '(Project Root)';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '96vw',
          maxWidth: '1440px',
          height: '92vh',
          background: 'var(--jb-panel-bg)',
          borderRadius: '8px',
          border: '1px solid var(--jb-border)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 16px 44px rgba(0, 0, 0, 0.8), 0 0 1px rgba(255, 255, 255, 0.2)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            borderBottom: '1px solid var(--jb-border)',
            background: 'rgba(255, 255, 255, 0.02)',
            userSelect: 'none',
          }}
        >
          {/* Title & Path Comparison Breadcrumbs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: 'rgba(53, 116, 240, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--jb-accent)',
                flexShrink: 0,
              }}
            >
              <GitCompare size={16} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap' }}>
                Compare Directories:
              </span>

              {/* Left Directory Chip */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: 'var(--jb-text)',
                  fontFamily: "'JetBrains Mono', monospace",
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
                title={`Left Directory: ${leftDisplay}`}
              >
                <Folder size={12} color="#e5ba64" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
                  {leftDisplay}
                </span>
              </div>

              {/* Swap Button */}
              <button
                className="jb-icon-btn"
                onClick={handleSwap}
                title="Swap Left and Right Directories"
                style={{
                  width: '24px',
                  height: '24px',
                  color: 'var(--jb-accent)',
                  background: 'rgba(53, 116, 240, 0.1)',
                  borderRadius: '4px',
                }}
              >
                <ArrowLeftRight size={13} />
              </button>

              {/* Right Directory Chip */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: 'var(--jb-text)',
                  fontFamily: "'JetBrains Mono', monospace",
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
                title={`Right Directory: ${rightDisplay}`}
              >
                <Folder size={12} color="#e5ba64" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
                  {rightDisplay}
                </span>
              </div>
            </div>
          </div>

          {/* Header Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {toast && (
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--jb-accent)',
                  background: 'rgba(53, 116, 240, 0.12)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  marginRight: '8px',
                  animation: 'fadeIn 0.2s ease',
                }}
              >
                {toast}
              </span>
            )}

            <button
              className="jb-icon-btn"
              onClick={() => loadComparison()}
              title="Refresh Directory Comparison"
              style={{ width: '26px', height: '26px' }}
            >
              <RotateCw size={13} className={loading ? 'jb-spin' : ''} />
            </button>

            <button
              className="jb-icon-btn"
              onClick={onClose}
              title="Close (Esc)"
              style={{ width: '26px', height: '26px' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* WebStorm Style Filter Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 14px',
            borderBottom: '1px solid var(--jb-border)',
            background: 'var(--jb-header-bg)',
            fontSize: '11px',
            gap: '12px',
            userSelect: 'none',
          }}
        >
          {/* Status Filter Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: 'var(--jb-text-dim)', marginRight: '4px', fontWeight: 600 }}>Filter:</span>

            {/* Different Filter */}
            <button
              onClick={() => setFilterDifferent(!filterDifferent)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                height: '24px',
                padding: '0 8px',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
                border: filterDifferent ? '1px solid var(--jb-accent)' : '1px solid var(--jb-border)',
                background: filterDifferent ? 'rgba(53, 116, 240, 0.2)' : 'transparent',
                color: filterDifferent ? '#fff' : 'var(--jb-text-muted)',
                fontWeight: filterDifferent ? 600 : 400,
              }}
              title="Show files with differing contents"
            >
              <span style={{ color: 'var(--jb-git-modified)', fontWeight: 700 }}>≠</span>
              <span>Different</span>
              <span
                style={{
                  fontSize: '9px',
                  padding: '1px 5px',
                  borderRadius: '10px',
                  background: 'rgba(229, 186, 100, 0.25)',
                  color: 'var(--jb-git-modified)',
                  fontWeight: 700,
                }}
              >
                {summary.different}
              </span>
            </button>

            {/* Left Only Filter */}
            <button
              onClick={() => setFilterLeftOnly(!filterLeftOnly)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                height: '24px',
                padding: '0 8px',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
                border: filterLeftOnly ? '1px solid var(--jb-git-untracked)' : '1px solid var(--jb-border)',
                background: filterLeftOnly ? 'rgba(74, 222, 128, 0.15)' : 'transparent',
                color: filterLeftOnly ? '#fff' : 'var(--jb-text-muted)',
                fontWeight: filterLeftOnly ? 600 : 400,
              }}
              title="Show files present only in Left directory"
            >
              <ArrowLeft size={11} color="var(--jb-git-untracked)" />
              <span>Only in Left</span>
              <span
                style={{
                  fontSize: '9px',
                  padding: '1px 5px',
                  borderRadius: '10px',
                  background: 'rgba(74, 222, 128, 0.25)',
                  color: 'var(--jb-git-untracked)',
                  fontWeight: 700,
                }}
              >
                {summary.leftOnly}
              </span>
            </button>

            {/* Right Only Filter */}
            <button
              onClick={() => setFilterRightOnly(!filterRightOnly)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                height: '24px',
                padding: '0 8px',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
                border: filterRightOnly ? '1px solid var(--jb-git-added)' : '1px solid var(--jb-border)',
                background: filterRightOnly ? 'rgba(96, 165, 250, 0.15)' : 'transparent',
                color: filterRightOnly ? '#fff' : 'var(--jb-text-muted)',
                fontWeight: filterRightOnly ? 600 : 400,
              }}
              title="Show files present only in Right directory"
            >
              <ArrowRight size={11} color="var(--jb-git-added)" />
              <span>Only in Right</span>
              <span
                style={{
                  fontSize: '9px',
                  padding: '1px 5px',
                  borderRadius: '10px',
                  background: 'rgba(96, 165, 250, 0.25)',
                  color: 'var(--jb-git-added)',
                  fontWeight: 700,
                }}
              >
                {summary.rightOnly}
              </span>
            </button>

            {/* Same Filter */}
            <button
              onClick={() => setFilterSame(!filterSame)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                height: '24px',
                padding: '0 8px',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
                border: filterSame ? '1px solid var(--jb-text-dim)' : '1px solid var(--jb-border)',
                background: filterSame ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                color: filterSame ? '#fff' : 'var(--jb-text-muted)',
                fontWeight: filterSame ? 600 : 400,
              }}
              title="Show identical files"
            >
              <Equal size={11} color="var(--jb-text-dim)" />
              <span>Identical</span>
              <span
                style={{
                  fontSize: '9px',
                  padding: '1px 5px',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.12)',
                  color: 'var(--jb-text-dim)',
                  fontWeight: 700,
                }}
              >
                {summary.same}
              </span>
            </button>
          </div>

          {/* Search Filter & Quick Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '3px 8px',
                borderRadius: '4px',
                border: '1px solid var(--jb-border)',
                width: '210px',
              }}
            >
              <Search size={12} color="var(--jb-text-dim)" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter files..."
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--jb-text)',
                  fontSize: '11px',
                  width: '100%',
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--jb-text-dim)' }}
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {selectedItem && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {selectedItem.status !== 'right_only' && (
                  <button
                    className="jb-btn-secondary"
                    onClick={() => handleSyncFile(selectedItem, 'copy_to_right')}
                    style={{ height: '24px', padding: '0 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    title="Copy left file version to right folder"
                  >
                    <ArrowRight size={11} />
                    <span>Copy to Right</span>
                  </button>
                )}

                {selectedItem.status !== 'left_only' && (
                  <button
                    className="jb-btn-secondary"
                    onClick={() => handleSyncFile(selectedItem, 'copy_to_left')}
                    style={{ height: '24px', padding: '0 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    title="Copy right file version to left folder"
                  >
                    <ArrowLeft size={11} />
                    <span>Copy to Left</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Content: Split between File List (Top) and Diff View (Bottom) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {/* Top: File List Table */}
          <div
            style={{
              height: `${listHeight}px`,
              minHeight: '100px',
              overflowY: 'auto',
              borderBottom: '1px solid var(--jb-border)',
              background: 'var(--jb-bg)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Table Header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '110px 1fr 100px 100px 120px',
                height: '24px',
                alignItems: 'center',
                padding: '0 12px',
                background: 'var(--jb-header-bg)',
                borderBottom: '1px solid var(--jb-border)',
                fontSize: '11px',
                color: 'var(--jb-text-muted)',
                fontWeight: 600,
                position: 'sticky',
                top: 0,
                zIndex: 1,
                userSelect: 'none',
              }}
            >
              <div>Status</div>
              <div>Relative Path</div>
              <div style={{ textAlign: 'right' }}>Left Size</div>
              <div style={{ textAlign: 'right' }}>Right Size</div>
              <div style={{ textAlign: 'center' }}>Actions</div>
            </div>

            {/* Loading / Error / Empty States */}
            {loading ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--jb-text-muted)', fontSize: '12px' }}>
                <RotateCw size={18} className="jb-spin" style={{ margin: '0 auto 8px', display: 'block' }} />
                Scanning and comparing directories...
              </div>
            ) : error ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--jb-git-conflict)', fontSize: '12px' }}>
                <AlertCircle size={20} style={{ margin: '0 auto 8px', display: 'block' }} />
                {error}
              </div>
            ) : filteredItems.length === 0 ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--jb-text-dim)', fontSize: '12px' }}>
                {compareResult?.items.length === 0
                  ? 'Both directories are empty or identical.'
                  : 'No files match current filter.'}
              </div>
            ) : (
              /* Item Rows */
              filteredItems.map((item) => {
                const isSelected = selectedItem?.relPath === item.relPath;
                return (
                  <div
                    key={item.relPath}
                    onClick={() => setSelectedItem(item)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '110px 1fr 100px 100px 120px',
                      height: '26px',
                      alignItems: 'center',
                      padding: '0 12px',
                      background: isSelected ? 'var(--jb-selection-bg)' : 'transparent',
                      borderLeft: isSelected ? '2px solid var(--jb-accent)' : '2px solid transparent',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                    className="jb-tree-row"
                  >
                    {/* Status Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {item.status === 'different' && (
                        <span
                          style={{
                            fontSize: '10px',
                            color: 'var(--jb-git-modified)',
                            background: 'rgba(229, 186, 100, 0.15)',
                            padding: '1px 6px',
                            borderRadius: '3px',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <b>≠</b> Modified
                        </span>
                      )}
                      {item.status === 'left_only' && (
                        <span
                          style={{
                            fontSize: '10px',
                            color: 'var(--jb-git-untracked)',
                            background: 'rgba(74, 222, 128, 0.15)',
                            padding: '1px 6px',
                            borderRadius: '3px',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <ArrowLeft size={10} /> Left only
                        </span>
                      )}
                      {item.status === 'right_only' && (
                        <span
                          style={{
                            fontSize: '10px',
                            color: 'var(--jb-git-added)',
                            background: 'rgba(96, 165, 250, 0.15)',
                            padding: '1px 6px',
                            borderRadius: '3px',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <ArrowRight size={10} /> Right only
                        </span>
                      )}
                      {item.status === 'same' && (
                        <span
                          style={{
                            fontSize: '10px',
                            color: 'var(--jb-text-dim)',
                            background: 'rgba(255, 255, 255, 0.06)',
                            padding: '1px 6px',
                            borderRadius: '3px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <Equal size={9} /> Same
                        </span>
                      )}
                    </div>

                    {/* Relative Path */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getFileIcon(item.name)}
                      <span style={{ color: isSelected ? '#fff' : 'var(--jb-text)', fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>
                        {item.relPath}
                      </span>
                    </div>

                    {/* Left Size */}
                    <div
                      style={{
                        textAlign: 'right',
                        color: item.size1 !== null ? 'var(--jb-text-muted)' : 'var(--jb-text-dim)',
                        fontSize: '11px',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {formatBytes(item.size1)}
                    </div>

                    {/* Right Size */}
                    <div
                      style={{
                        textAlign: 'right',
                        color: item.size2 !== null ? 'var(--jb-text-muted)' : 'var(--jb-text-dim)',
                        fontSize: '11px',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {formatBytes(item.size2)}
                    </div>

                    {/* Row Sync Actions */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {item.status !== 'right_only' && (
                        <button
                          className="jb-icon-btn"
                          style={{ width: '20px', height: '20px' }}
                          onClick={() => handleSyncFile(item, 'copy_to_right')}
                          title="Copy file from left to right"
                        >
                          <ArrowRight size={11} color="var(--jb-accent)" />
                        </button>
                      )}

                      {item.status !== 'left_only' && (
                        <button
                          className="jb-icon-btn"
                          style={{ width: '20px', height: '20px' }}
                          onClick={() => handleSyncFile(item, 'copy_to_left')}
                          title="Copy file from right to left"
                        >
                          <ArrowLeft size={11} color="var(--jb-accent)" />
                        </button>
                      )}

                      {item.status === 'left_only' && (
                        <button
                          className="jb-icon-btn"
                          style={{ width: '20px', height: '20px' }}
                          onClick={() => handleSyncFile(item, 'delete_left')}
                          title="Delete file from left directory"
                        >
                          <Trash2 size={11} color="var(--jb-git-conflict)" />
                        </button>
                      )}

                      {item.status === 'right_only' && (
                        <button
                          className="jb-icon-btn"
                          style={{ width: '20px', height: '20px' }}
                          onClick={() => handleSyncFile(item, 'delete_right')}
                          title="Delete file from right directory"
                        >
                          <Trash2 size={11} color="var(--jb-git-conflict)" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Splitter */}
          <div
            onMouseDown={handleSplitterMouseDown}
            style={{
              height: '5px',
              background: 'var(--jb-border)',
              cursor: 'row-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              userSelect: 'none',
            }}
            title="Drag to resize file list and diff viewer"
          >
            <div style={{ width: '30px', height: '2px', background: 'var(--jb-text-dim)', borderRadius: '1px' }} />
          </div>

          {/* Bottom: Diff Editor Pane */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--jb-bg)' }}>
            {selectedItem ? (
              diffLoading ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--jb-text-muted)', fontSize: '12px', gap: '8px' }}>
                  <RotateCw size={14} className="jb-spin" />
                  <span>Loading diff for {selectedItem.name}...</span>
                </div>
              ) : diffContent ? (
                <DiffEditor
                  filePath={`${leftDir ? `${leftDir}/${selectedItem.relPath}` : selectedItem.relPath} ↔ ${rightDir ? `${rightDir}/${selectedItem.relPath}` : selectedItem.relPath}`}
                  original={diffContent.original}
                  modified={diffContent.modified}
                  compareTitle={`${selectedItem.name} (${selectedItem.relPath})`}
                  leftLabel={`${leftDisplay}/${selectedItem.relPath}`}
                  rightLabel={`${rightDisplay}/${selectedItem.relPath}`}
                  onSaved={async () => {
                    await loadDiff(selectedItem);
                    await loadComparison();
                  }}
                  onRollback={() => {}}
                />
              ) : null
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--jb-text-dim)',
                  fontSize: '12px',
                  gap: '6px',
                }}
              >
                <GitCompare size={28} color="rgba(255, 255, 255, 0.15)" />
                <span>Select a file from the list above to view side-by-side diff</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
