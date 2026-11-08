import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search,
  X,
  RotateCw,
  Folder,
  FolderOpen,
  FileCode,
  FileJson,
  FileText,
  File,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  ChevronsDownUp,
  CaseSensitive,
  WholeWord,
  Regex,
  FolderTree,
  List,
  Filter,
} from 'lucide-react';
import { searchProjectFiles } from '../api';
import { SearchResult, SearchFileResult, SearchMatch } from '../types';

interface FindToolWindowProps {
  isOpen: boolean;
  onClose: () => void;
  activeRepoRoot?: string;
  repoName?: string;
  initialQuery?: string;
  initialScope?: string;
  onOpenMatch: (filePath: string, line: number, column: number, length: number) => void;
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

// Highlight matched search term in line text
function renderHighlightedLine(lineText: string, matchText: string, isRegex = false, matchCase = false) {
  if (!matchText) return <span>{lineText}</span>;

  try {
    let regex: RegExp;
    if (isRegex) {
      regex = new RegExp(`(${matchText})`, matchCase ? 'g' : 'gi');
    } else {
      const escaped = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(`(${escaped})`, matchCase ? 'g' : 'gi');
    }

    const parts = lineText.split(regex);
    return (
      <span>
        {parts.map((part, i) => {
          const isMatch = isRegex
            ? regex.test(part)
            : matchCase
            ? part === matchText
            : part.toLowerCase() === matchText.toLowerCase();

          return isMatch ? (
            <mark
              key={i}
              style={{
                background: 'rgba(234, 179, 8, 0.4)',
                color: '#fff',
                padding: '0 1px',
                borderRadius: '2px',
                fontWeight: 600,
              }}
            >
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          );
        })}
      </span>
    );
  } catch {
    return <span>{lineText}</span>;
  }
}

export const FindToolWindow: React.FC<FindToolWindowProps> = ({
  isOpen,
  onClose,
  activeRepoRoot,
  repoName,
  initialQuery = '',
  initialScope = '',
  onOpenMatch,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [fileMask, setFileMask] = useState('');
  const [scope, setScope] = useState(initialScope);
  const [groupByDir, setGroupByDir] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  // Expanded tree nodes
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  // Selected match for keyboard navigation
  const [selectedMatchKey, setSelectedMatchKey] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync initial query/scope when opened
  useEffect(() => {
    if (isOpen) {
      if (initialQuery && initialQuery !== query) {
        setQuery(initialQuery);
      }
      if (initialScope) {
        setScope(initialScope);
      }
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 50);
    }
  }, [isOpen, initialQuery, initialScope]);

  // Execute Search
  const runSearch = useCallback(
    async (overrideQuery?: string) => {
      const q = (overrideQuery !== undefined ? overrideQuery : query).trim();
      if (!q) {
        setResult(null);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await searchProjectFiles({
          query: q,
          matchCase,
          wholeWord,
          isRegex,
          fileMask: fileMask.trim(),
          scope: scope.trim(),
          repoRoot: activeRepoRoot,
        });

        setResult(res);

        // Auto-expand all folders and files initially
        const autoExpanded = new Set<string>();
        res.files.forEach((f) => {
          if (f.dirPath) autoExpanded.add(`dir:${f.dirPath}`);
          autoExpanded.add(`file:${f.filePath}`);
        });
        setExpandedNodes(autoExpanded);

        // Select first match if any
        if (res.files.length > 0 && res.files[0].matches.length > 0) {
          const first = res.files[0];
          const m = first.matches[0];
          setSelectedMatchKey(`${first.filePath}:${m.line}:${m.column}`);
        } else {
          setSelectedMatchKey(null);
        }
      } catch (err: any) {
        setError(err.message || 'Search failed');
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [query, matchCase, wholeWord, isRegex, fileMask, scope, activeRepoRoot]
  );

  // Re-run on search options change or when query changes (with debounce)
  useEffect(() => {
    if (!isOpen || !query.trim()) return;
    const timer = setTimeout(() => {
      runSearch();
    }, 250);
    return () => clearTimeout(timer);
  }, [isOpen, query, matchCase, wholeWord, isRegex, fileMask, scope, activeRepoRoot]);

  // Grouped results by Directory
  const groupedData = useMemo(() => {
    if (!result || !result.files) return [];

    if (!groupByDir) {
      return result.files.map((file) => ({
        dirPath: '',
        files: [file],
        totalDirMatches: file.matches.length,
      }));
    }

    const dirMap = new Map<string, SearchFileResult[]>();
    for (const f of result.files) {
      const d = f.dirPath || '.';
      if (!dirMap.has(d)) dirMap.set(d, []);
      dirMap.get(d)!.push(f);
    }

    return Array.from(dirMap.entries()).map(([dirPath, files]) => ({
      dirPath,
      files,
      totalDirMatches: files.reduce((sum, f) => sum + f.matches.length, 0),
    }));
  }, [result, groupByDir]);

  // Expand / Collapse all
  const handleExpandAll = () => {
    if (!result) return;
    const all = new Set<string>();
    result.files.forEach((f) => {
      if (f.dirPath) all.add(`dir:${f.dirPath}`);
      all.add(`file:${f.filePath}`);
    });
    setExpandedNodes(all);
  };

  const handleCollapseAll = () => {
    setExpandedNodes(new Set());
  };

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // Flat list of matches for keyboard navigation (ArrowUp / ArrowDown)
  const flatMatches = useMemo(() => {
    if (!result || !result.files) return [];
    const list: { file: SearchFileResult; match: SearchMatch; key: string }[] = [];
    for (const file of result.files) {
      for (const match of file.matches) {
        list.push({
          file,
          match,
          key: `${file.filePath}:${match.line}:${match.column}`,
        });
      }
    }
    return list;
  }, [result]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (flatMatches.length === 0) return;
      e.preventDefault();
      const currentIdx = flatMatches.findIndex((item) => item.key === selectedMatchKey);
      let nextIdx = 0;
      if (e.key === 'ArrowDown') {
        nextIdx = currentIdx < flatMatches.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : flatMatches.length - 1;
      }
      const target = flatMatches[nextIdx];
      if (target) {
        setSelectedMatchKey(target.key);
        onOpenMatch(target.file.filePath, target.match.line, target.match.column, target.match.matchText.length);
      }
    } else if (e.key === 'Enter') {
      if (selectedMatchKey) {
        const item = flatMatches.find((m) => m.key === selectedMatchKey);
        if (item) {
          onOpenMatch(item.file.filePath, item.match.line, item.match.column, item.match.matchText.length);
        }
      } else if (flatMatches.length > 0) {
        const first = flatMatches[0];
        setSelectedMatchKey(first.key);
        onOpenMatch(first.file.filePath, first.match.line, first.match.column, first.match.matchText.length);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--jb-panel-bg)',
        borderTop: '1px solid var(--jb-border)',
        fontSize: '12px',
        color: 'var(--jb-text)',
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Top Search Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '36px',
          padding: '0 10px',
          background: 'var(--jb-header-bg)',
          borderBottom: '1px solid var(--jb-border)',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        {/* Left: Search input & modifiers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, maxWidth: '850px' }}>
          {/* Query input container */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--jb-bg)',
              border: '1px solid var(--jb-border)',
              borderRadius: '4px',
              padding: '2px 8px',
              height: '24px',
              flex: 1,
              maxWidth: '380px',
              gap: '6px',
            }}
          >
            <Search size={13} color="var(--jb-text-dim)" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Find in Files (Enter to search, Esc to close)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runSearch();
                }
              }}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#fff',
                fontSize: '12px',
                width: '100%',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--jb-text-dim)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Modifiers: Case, Word, Regex */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <button
              className={`jb-icon-btn ${matchCase ? 'active' : ''}`}
              style={{ width: '24px', height: '24px' }}
              onClick={() => setMatchCase(!matchCase)}
              title="Match Case (Alt+C)"
            >
              <CaseSensitive size={14} color={matchCase ? '#fff' : 'var(--jb-text-muted)'} />
            </button>
            <button
              className={`jb-icon-btn ${wholeWord ? 'active' : ''}`}
              style={{ width: '24px', height: '24px' }}
              onClick={() => setWholeWord(!wholeWord)}
              title="Match Whole Word (Alt+W)"
            >
              <WholeWord size={14} color={wholeWord ? '#fff' : 'var(--jb-text-muted)'} />
            </button>
            <button
              className={`jb-icon-btn ${isRegex ? 'active' : ''}`}
              style={{ width: '24px', height: '24px' }}
              onClick={() => setIsRegex(!isRegex)}
              title="Regular Expression (Alt+X)"
            >
              <Regex size={14} color={isRegex ? '#fff' : 'var(--jb-text-muted)'} />
            </button>
          </div>

          <div style={{ width: '1px', height: '16px', background: 'var(--jb-border)', margin: '0 2px' }} />

          {/* File Mask Filter */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--jb-bg)',
              border: '1px solid var(--jb-border)',
              borderRadius: '4px',
              padding: '2px 6px',
              height: '24px',
              width: '150px',
              gap: '4px',
            }}
          >
            <Filter size={11} color="var(--jb-text-dim)" />
            <input
              type="text"
              placeholder="File mask (*.ts...)"
              value={fileMask}
              onChange={(e) => setFileMask(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#fff',
                fontSize: '11px',
                width: '100%',
              }}
              title="Filter files by mask (e.g. *.ts, *.tsx, *.json)"
            />
            {fileMask && (
              <button
                onClick={() => setFileMask('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--jb-text-dim)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>

          {/* Scope Indicator / Filter */}
          {scope && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: 'rgba(86, 168, 245, 0.15)',
                color: 'var(--jb-accent)',
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '3px',
                border: '1px solid rgba(86, 168, 245, 0.3)',
              }}
              title={`Search scoped to: ${scope}`}
            >
              <span>{scope}</span>
              <button
                onClick={() => setScope('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--jb-accent)',
                  cursor: 'pointer',
                  padding: 0,
                }}
                title="Clear directory scope"
              >
                <X size={11} />
              </button>
            </div>
          )}

          {/* Rerun Search Button */}
          <button
            className="jb-icon-btn"
            style={{ width: '24px', height: '24px' }}
            onClick={() => runSearch()}
            title="Rerun Search"
          >
            <RotateCw size={13} className={loading ? 'jb-spin' : ''} />
          </button>
        </div>

        {/* Right: Results Count & Tree View Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Summary */}
          {result && (
            <span style={{ fontSize: '11px', color: 'var(--jb-text-muted)', whiteSpace: 'nowrap' }}>
              <strong style={{ color: 'var(--jb-text)' }}>{result.totalMatches}</strong> match
              {result.totalMatches !== 1 ? 'es' : ''} in{' '}
              <strong style={{ color: 'var(--jb-text)' }}>{result.totalFiles}</strong> file
              {result.totalFiles !== 1 ? 's' : ''}
              {result.durationMs !== undefined ? ` (${(result.durationMs / 1000).toFixed(2)}s)` : ''}
            </span>
          )}

          {/* Group by Directory Toggle */}
          <button
            className={`jb-icon-btn ${groupByDir ? 'active' : ''}`}
            style={{ width: '24px', height: '24px' }}
            onClick={() => setGroupByDir(!groupByDir)}
            title={groupByDir ? 'Group by Directory (Enabled)' : 'Group by Directory (Disabled)'}
          >
            {groupByDir ? <FolderTree size={14} /> : <List size={14} />}
          </button>

          {/* Expand All / Collapse All */}
          <button
            className="jb-icon-btn"
            style={{ width: '24px', height: '24px' }}
            onClick={handleExpandAll}
            title="Expand All"
          >
            <ChevronsUpDown size={14} />
          </button>
          <button
            className="jb-icon-btn"
            style={{ width: '24px', height: '24px' }}
            onClick={handleCollapseAll}
            title="Collapse All"
          >
            <ChevronsDownUp size={14} />
          </button>

          <div style={{ width: '1px', height: '16px', background: 'var(--jb-border)' }} />

          {/* Close Panel Button */}
          <button
            className="jb-icon-btn"
            style={{ width: '24px', height: '24px' }}
            onClick={onClose}
            title="Close Find Tool Window (Escape)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Results Tree Container */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0' }}>
        {loading && !result && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '8px',
              color: 'var(--jb-text-muted)',
              fontSize: '12px',
            }}
          >
            <RotateCw size={14} className="jb-spin" />
            <span>Searching project files for "{query}"...</span>
          </div>
        )}

        {error && (
          <div style={{ padding: '16px', color: 'var(--jb-git-conflict)', fontSize: '12px' }}>
            Error performing search: {error}
          </div>
        )}

        {!loading && result && result.totalMatches === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--jb-text-dim)',
              fontSize: '12px',
              gap: '4px',
            }}
          >
            <span>No occurrences found for "{result.query}"</span>
            <span style={{ fontSize: '11px' }}>Try adjusting case sensitivity, word match, or file mask</span>
          </div>
        )}

        {!loading && !result && !error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--jb-text-dim)',
              fontSize: '12px',
            }}
          >
            Type search query above and press Enter to search across the whole project
          </div>
        )}

        {/* Tree Rows */}
        {result &&
          result.totalMatches > 0 &&
          groupedData.map((group) => {
            const isDirExpanded = expandedNodes.has(`dir:${group.dirPath}`);

            return (
              <div key={group.dirPath || 'root'}>
                {/* Directory Node (if grouped by dir) */}
                {groupByDir && group.dirPath && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      height: '24px',
                      paddingLeft: '8px',
                      paddingRight: '8px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--jb-text)',
                      background: 'rgba(255, 255, 255, 0.02)',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                      userSelect: 'none',
                    }}
                    onClick={() => toggleNode(`dir:${group.dirPath}`)}
                    className="jb-tree-row"
                  >
                    <span style={{ marginRight: '4px', display: 'inline-flex' }}>
                      {isDirExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                    <span style={{ marginRight: '6px', display: 'inline-flex', color: 'var(--jb-accent)' }}>
                      {isDirExpanded ? <FolderOpen size={13} /> : <Folder size={13} />}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {group.dirPath}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'var(--jb-text-dim)',
                        background: 'rgba(255, 255, 255, 0.06)',
                        padding: '1px 6px',
                        borderRadius: '10px',
                        fontWeight: 500,
                      }}
                    >
                      {group.totalDirMatches} match{group.totalDirMatches !== 1 ? 'es' : ''}
                    </span>
                  </div>
                )}

                {/* Files in this group */}
                {(!groupByDir || isDirExpanded) &&
                  group.files.map((file) => {
                    const isFileExpanded = expandedNodes.has(`file:${file.filePath}`);
                    const indent = groupByDir && group.dirPath ? 22 : 8;

                    return (
                      <div key={file.filePath}>
                        {/* File Row */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            height: '22px',
                            paddingLeft: `${indent}px`,
                            paddingRight: '8px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: 500,
                            color: 'var(--jb-text)',
                            background: 'transparent',
                            userSelect: 'none',
                          }}
                          onClick={() => toggleNode(`file:${file.filePath}`)}
                          className="jb-tree-row"
                        >
                          <span style={{ marginRight: '4px', display: 'inline-flex' }}>
                            {isFileExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </span>
                          <span style={{ marginRight: '6px', display: 'inline-flex' }}>
                            {getFileIcon(file.fileName)}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {file.fileName}
                            {!groupByDir && file.dirPath && (
                              <span style={{ color: 'var(--jb-text-dim)', marginLeft: '8px', fontSize: '11px' }}>
                                {file.dirPath}
                              </span>
                            )}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              color: 'var(--jb-text-dim)',
                              marginLeft: '6px',
                            }}
                          >
                            ({file.matches.length})
                          </span>
                        </div>

                        {/* Match rows under file */}
                        {isFileExpanded &&
                          file.matches.map((m, mIdx) => {
                            const matchKey = `${file.filePath}:${m.line}:${m.column}`;
                            const isSelected = selectedMatchKey === matchKey;
                            const matchIndent = indent + 20;

                            return (
                              <div
                                key={mIdx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'baseline',
                                  minHeight: '20px',
                                  paddingLeft: `${matchIndent}px`,
                                  paddingRight: '8px',
                                  cursor: 'pointer',
                                  fontSize: '11.5px',
                                  fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
                                  background: isSelected ? 'rgba(53, 116, 240, 0.25)' : 'transparent',
                                  borderLeft: isSelected ? '2px solid var(--jb-accent)' : '2px solid transparent',
                                  whiteSpace: 'pre',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                                onClick={() => {
                                  setSelectedMatchKey(matchKey);
                                  onOpenMatch(file.filePath, m.line, m.column, m.matchText.length);
                                }}
                                className="jb-tree-row"
                                title={`Line ${m.line}, Column ${m.column}: ${m.lineText}`}
                              >
                                {/* Line Number Badge */}
                                <span
                                  style={{
                                    color: 'var(--jb-text-dim)',
                                    minWidth: '34px',
                                    textAlign: 'right',
                                    marginRight: '10px',
                                    fontSize: '10.5px',
                                    userSelect: 'none',
                                    flexShrink: 0,
                                  }}
                                >
                                  {m.line}:
                                </span>

                                {/* Code Line Snippet with Highlighting */}
                                <span style={{ color: 'var(--jb-text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {renderHighlightedLine(m.lineText, m.matchText, isRegex, matchCase)}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
              </div>
            );
          })}
      </div>
    </div>
  );
};
