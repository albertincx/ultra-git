import React, { useEffect, useRef, useState, useCallback } from 'react';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  keymap,
  gutter,
  GutterMarker,
} from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { MergeView, unifiedMergeView, goToNextChunk, goToPreviousChunk, Chunk } from '@codemirror/merge';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  search,
  setSearchQuery as setCmSearchQuery,
  SearchQuery,
  SearchCursor,
  highlightSelectionMatches,
} from '@codemirror/search';
import {
  Save,
  ChevronDown,
  ChevronUp,
  Columns2,
  RotateCcw,
  Check,
  FileCode,
  PlusCircle,
  Undo2,
  Search,
  X,
  CaseSensitive,
} from 'lucide-react';
import { saveFileContent } from '../api';
import { GitFileStatus } from '../types';
import { DiffEngineType, DiffEngineHandle } from './diff-engines/types';

const MonacoEngine = React.lazy(() => import('./diff-engines/MonacoEngine'));

interface DiffEditorProps {
  filePath: string;
  fileStatus?: GitFileStatus;
  original: string;
  modified: string;
  onSaved: () => void;
  onRollback: () => void;
}

// Custom Gutter Marker for rolling back individual chunk
class RollbackGutterMarker extends GutterMarker {
  constructor(public onRevert: () => void) {
    super();
  }

  toDOM() {
    const btn = document.createElement('button');
    btn.className = 'jb-gutter-revert-btn';
    btn.title = 'Rollback this change (revert to HEAD)';
    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>`;
    btn.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onRevert();
    };
    return btn;
  }
}

export const DiffEditor: React.FC<DiffEditorProps> = ({
  filePath,
  fileStatus,
  original,
  modified: initialModified,
  onSaved,
  onRollback,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);
  const singleEditorRef = useRef<EditorView | null>(null);
  const unifiedViewRef = useRef<EditorView | null>(null);
  const engineRef = useRef<DiffEngineHandle>(null);

  const [currentModified, setCurrentModified] = useState(initialModified);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUnified, setIsUnified] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);


  // Untracked or brand new file with no HEAD original
  const isUntrackedOrNew = fileStatus === 'untracked' || (!original && fileStatus === 'added');

  // Sync content when switching files
  useEffect(() => {
    setCurrentModified(initialModified);
    setIsDirty(false);
  }, [filePath, initialModified]);

  // Immediate synchronous calculation of difference chunks so the counter is accurate instantly on load
  useEffect(() => {
    if (isUntrackedOrNew) {
      setChunkCount(0);
      return;
    }
    try {
      const stateA = EditorState.create({ doc: original });
      const stateB = EditorState.create({ doc: initialModified });
      const chunks = Chunk.build(stateA.doc, stateB.doc, {});
      setChunkCount(chunks ? chunks.length : 0);
    } catch (e) {
      console.warn('Sync chunk calculation error:', e);
    }
  }, [filePath, original, initialModified, isUntrackedOrNew]);

  // Diff Engine state (Monaco by default)
  const [diffEngine, setDiffEngine] = useState<DiffEngineType>(() => {
    return (localStorage.getItem('ultra_diff_engine') as DiffEngineType) || 'monaco';
  });

  const handleEngineChange = (engine: DiffEngineType) => {
    setDiffEngine(engine);
    localStorage.setItem('ultra_diff_engine', engine);
  };

  // Search in Diff state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [searchScope, setSearchScope] = useState<'both' | 'left' | 'right'>('both');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [matches, setMatches] = useState<{ side: 'a' | 'b' | 'single'; from: number; to: number; line: number }[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Chunks info for toolbar
  const [chunkCount, setChunkCount] = useState(0);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);


  // Determine language extension
  const getLanguageExtension = (path: string) => {
    if (path.endsWith('.json')) return json();
    if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.ts') || path.endsWith('.tsx')) {
      return javascript({ typescript: true, jsx: true });
    }
    return [];
  };

  const handleSave = async (contentToSave?: string) => {
    const text = contentToSave !== undefined ? contentToSave : currentModified;
    setIsSaving(true);
    try {
      const targetSavePath = filePath.includes(' ↔ ') ? filePath.split(' ↔ ')[1] : filePath;
      await saveFileContent(targetSavePath, text);
      setIsDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      onSaved();
    } catch (e) {
      console.error('Error saving file:', e);
      alert('Failed to save file: ' + (e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  // Scroll to match and center line in view
  const scrollToMatch = useCallback((match: { side: 'a' | 'b' | 'single'; from: number; to: number }) => {
    if (!match) return;
    try {
      if (mergeViewRef.current) {
        const mv = mergeViewRef.current;
        const targetView = match.side === 'a' ? mv.a : mv.b;
        targetView.dispatch({
          selection: { anchor: match.from, head: match.to },
        });
        const block = targetView.lineBlockAt(match.from);
        if (mv.dom && block) {
          mv.dom.scrollTop = Math.max(0, block.top - 120);
        }
      } else if (singleEditorRef.current) {
        const view = singleEditorRef.current;
        view.dispatch({
          selection: { anchor: match.from, head: match.to },
        });
        const block = view.lineBlockAt(match.from);
        if (view.scrollDOM && block) {
          view.scrollDOM.scrollTop = Math.max(0, block.top - 120);
        }
      } else if (unifiedViewRef.current) {
        const view = unifiedViewRef.current;
        view.dispatch({
          selection: { anchor: match.from, head: match.to },
        });
        const block = view.lineBlockAt(match.from);
        if (view.scrollDOM && block) {
          view.scrollDOM.scrollTop = Math.max(0, block.top - 120);
        }
      }
    } catch (e) {
      console.warn('Failed to scroll to match:', e);
    }
  }, []);

  // Perform search across editors
  useEffect(() => {
    if (!searchQuery.trim()) {
      setMatches([]);
      setCurrentMatchIndex(0);
      const clearQuery = setCmSearchQuery.of(new SearchQuery({ search: '' }));
      if (mergeViewRef.current) {
        mergeViewRef.current.a.dispatch({ effects: clearQuery });
        mergeViewRef.current.b.dispatch({ effects: clearQuery });
      }
      if (singleEditorRef.current) singleEditorRef.current.dispatch({ effects: clearQuery });
      if (unifiedViewRef.current) unifiedViewRef.current.dispatch({ effects: clearQuery });
      return;
    }

    const queryEffect = setCmSearchQuery.of(
      new SearchQuery({
        search: searchQuery,
        caseSensitive: matchCase,
      })
    );

    const foundMatches: { side: 'a' | 'b' | 'single'; from: number; to: number; line: number }[] = [];

    const findInDoc = (doc: any, side: 'a' | 'b' | 'single') => {
      try {
        const cursor = new SearchCursor(doc, searchQuery, 0, doc.length, matchCase ? undefined : (x) => x.toLowerCase());
        while (!cursor.next().done) {
          const line = doc.lineAt(cursor.value.from).number;
          foundMatches.push({
            side,
            from: cursor.value.from,
            to: cursor.value.to,
            line,
          });
        }
      } catch (err) {
        console.warn('Search in doc error:', err);
      }
    };

    if (mergeViewRef.current) {
      const mv = mergeViewRef.current;
      mv.a.dispatch({ effects: queryEffect });
      mv.b.dispatch({ effects: queryEffect });

      if (searchScope === 'both' || searchScope === 'left') {
        findInDoc(mv.a.state.doc, 'a');
      }
      if (searchScope === 'both' || searchScope === 'right') {
        findInDoc(mv.b.state.doc, 'b');
      }
    } else if (singleEditorRef.current) {
      const view = singleEditorRef.current;
      view.dispatch({ effects: queryEffect });
      findInDoc(view.state.doc, 'single');
    } else if (unifiedViewRef.current) {
      const view = unifiedViewRef.current;
      view.dispatch({ effects: queryEffect });
      findInDoc(view.state.doc, 'single');
    }

    foundMatches.sort((m1, m2) => {
      if (m1.line !== m2.line) return m1.line - m2.line;
      return m1.from - m2.from;
    });

    setMatches(foundMatches);
    setCurrentMatchIndex(0);
    if (foundMatches.length > 0) {
      scrollToMatch(foundMatches[0]);
    }
  }, [searchQuery, matchCase, searchScope, scrollToMatch]);

  const handleNextMatch = () => {
    if (matches.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIdx);
    scrollToMatch(matches[nextIdx]);
  };

  const handlePrevMatch = () => {
    if (matches.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatchIndex(prevIdx);
    scrollToMatch(matches[prevIdx]);
  };

  // Keyboard shortcut: Cmd+S, Cmd+F, F7, Shift+F7
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F7') {
        e.preventDefault();
        if (e.shiftKey) {
          handlePrevChunk();
        } else {
          handleNextChunk();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 50);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filePath, currentModified, chunkCount, diffEngine]);

  // Rollback a specific chunk
  const handleRevertChunk = (chunkIndex: number) => {
    if (!mergeViewRef.current) return;
    const mv = mergeViewRef.current;
    const chunk = mv.chunks[chunkIndex];
    if (!chunk) return;

    // Get original text from HEAD (editor A)
    const origText = mv.a.state.sliceDoc(chunk.fromA, chunk.toA);

    // Replace in working copy (editor B)
    mv.b.dispatch({
      changes: {
        from: chunk.fromB,
        to: Math.min(mv.b.state.doc.length, chunk.toB),
        insert: origText,
      },
      userEvent: 'revert',
    });

    const newDoc = mv.b.state.doc.toString();
    setCurrentModified(newDoc);
    handleSave(newDoc);
  };

  // Rollback current focused chunk
  const handleRevertCurrentChunk = () => {
    if (diffEngine === 'monaco' && engineRef.current) {
      engineRef.current.revertCurrentDiff();
    } else {
      handleRevertChunk(currentChunkIndex);
    }
  };

  // Next / Previous difference chunk
  const handleNextChunk = () => {
    if (diffEngine === 'monaco' && engineRef.current) {
      engineRef.current.nextDiff();
    } else if (diffEngine === 'codemirror') {
      if (mergeViewRef.current) {
        goToNextChunk(mergeViewRef.current.b);
        setCurrentChunkIndex((prev) => (chunkCount > 0 ? (prev + 1) % chunkCount : 0));
      } else if (unifiedViewRef.current) {
        goToNextChunk(unifiedViewRef.current);
        setCurrentChunkIndex((prev) => (chunkCount > 0 ? (prev + 1) % chunkCount : 0));
      }
    }
  };

  const handlePrevChunk = () => {
    if (diffEngine === 'monaco' && engineRef.current) {
      engineRef.current.prevDiff();
    } else if (diffEngine === 'codemirror') {
      if (mergeViewRef.current) {
        goToPreviousChunk(mergeViewRef.current.b);
        setCurrentChunkIndex((prev) => (chunkCount > 0 ? (prev - 1 + chunkCount) % chunkCount : 0));
      } else if (unifiedViewRef.current) {
        goToPreviousChunk(unifiedViewRef.current);
        setCurrentChunkIndex((prev) => (chunkCount > 0 ? (prev - 1 + chunkCount) % chunkCount : 0));
      }
    }
  };

  // Render Editor / Diff
  useEffect(() => {
    if (diffEngine !== 'codemirror') return;
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';
    setCurrentModified(initialModified);
    setIsDirty(false);

    const lang = getLanguageExtension(filePath);

    // 1. Untracked / Brand New File: Render Single Full-Width Editor
    if (isUntrackedOrNew) {
      setChunkCount(0);
      const state = EditorState.create({
        doc: initialModified,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          oneDark,
          lang,
          search({ top: false }),
          highlightSelectionMatches(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newDoc = update.state.doc.toString();
              setCurrentModified(newDoc);
              setIsDirty(true);
            }
          }),
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      singleEditorRef.current = view;
      mergeViewRef.current = null;
      unifiedViewRef.current = null;

      return () => {
        view.destroy();
      };
    }

    // 2. Modified File: Unified Diff View
    if (isUnified) {
      const state = EditorState.create({
        doc: initialModified,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          oneDark,
          lang,
          search({ top: false }),
          highlightSelectionMatches(),
          unifiedMergeView({
            original,
            highlightChanges: true,
            mergeControls: true,
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newDoc = update.state.doc.toString();
              setCurrentModified(newDoc);
              setIsDirty(true);
            }
          }),
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      unifiedViewRef.current = view;
      mergeViewRef.current = null;
      singleEditorRef.current = null;

      setTimeout(() => {
        goToNextChunk(view);
      }, 60);

      return () => {
        view.destroy();
      };
    } else {
      // 3. Modified File: Side-by-Side MergeView

      // Custom Rollback Gutter extension placed on Editor B (strictly sorted and deduplicated)
      const rollbackGutterExtension = gutter({
        class: 'cm-rollback-gutter',
        markers: (view) => {
          const builder = new RangeSetBuilder<GutterMarker>();
          try {
            const mv = mergeViewRef.current;
            if (mv && mv.chunks && mv.chunks.length > 0) {
              const markersList: { pos: number; marker: GutterMarker }[] = [];
              const seenLines = new Set<number>();
              for (let i = 0; i < mv.chunks.length; i++) {
                const chunk = mv.chunks[i];
                if (chunk && chunk.fromB <= view.state.doc.length) {
                  const line = view.state.doc.lineAt(chunk.fromB);
                  if (!seenLines.has(line.from)) {
                    seenLines.add(line.from);
                    markersList.push({
                      pos: line.from,
                      marker: new RollbackGutterMarker(() => handleRevertChunk(i)),
                    });
                  }
                }
              }
              // CodeMirror requires RangeSet keys to be strictly sorted by position
              markersList.sort((a, b) => a.pos - b.pos);
              for (const item of markersList) {
                builder.add(item.pos, item.pos, item.marker);
              }
            }
          } catch (e) {
            console.warn('Gutter marker calculation error:', e);
          }
          return builder.finish();
        },
      });

      const mergeView = new MergeView({
        a: {
          doc: original,
          extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightActiveLine(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            oneDark,
            lang,
            search({ top: false }),
            highlightSelectionMatches(),
            EditorState.readOnly.of(true),
          ],
        },
        b: {
          doc: initialModified,
          extensions: [
            rollbackGutterExtension,
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightActiveLine(),
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            oneDark,
            lang,
            search({ top: false }),
            highlightSelectionMatches(),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                const newDoc = update.state.doc.toString();
                setCurrentModified(newDoc);
                setIsDirty(true);
                if (update.transactions.some((tr) => tr.isUserEvent('revert'))) {
                  handleSave(newDoc);
                }
              }
            }),
          ],
        },
        parent: containerRef.current,
        gutter: true,
        highlightChanges: true,
        revertControls: 'a-to-b',
        renderRevertControl: () => {
          const btn = document.createElement('button');
          btn.className = 'jb-revert-chunk-btn';
          btn.title = 'Rollback this change (revert to HEAD)';
          btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
          return btn;
        },
      });

      mergeViewRef.current = mergeView;
      unifiedViewRef.current = null;
      singleEditorRef.current = null;

      const totalChunks = mergeView.chunks?.length || 0;
      setChunkCount(totalChunks);

      // Auto-scroll to first difference chunk safely
      setTimeout(() => {
        try {
          if (mergeView && mergeView.chunks && mergeView.chunks.length > 0) {
            goToNextChunk(mergeView.b);
          }
        } catch (err) {
          console.warn('Auto-scroll to first chunk error:', err);
        }
      }, 70);

      return () => {
        mergeView.destroy();
      };
    }
  }, [diffEngine, filePath, original, initialModified, isUnified, isUntrackedOrNew]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Diff Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '38px',
          padding: '0 12px',
          background: 'var(--jb-header-bg)',
          borderBottom: '1px solid var(--jb-border)',
          fontSize: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileCode size={16} color="var(--jb-text-muted)" />
          <span style={{ fontWeight: 600, color: 'var(--jb-text)' }}>{filePath}</span>

          {isUntrackedOrNew ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                background: 'rgba(115, 201, 145, 0.15)',
                color: 'var(--jb-git-untracked)',
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '3px',
                fontWeight: 500,
              }}
            >
              <PlusCircle size={10} />
              Untracked File
            </span>
          ) : (
            <span
              style={{
                background: 'rgba(86, 168, 245, 0.15)',
                color: 'var(--jb-git-modified)',
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '3px',
                fontWeight: 500,
              }}
            >
              {chunkCount} difference{chunkCount !== 1 ? 's' : ''}
            </span>
          )}

          {isDirty && (
            <span
              style={{
                background: 'var(--jb-accent)',
                color: '#fff',
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '3px',
                fontWeight: 500,
              }}
            >
              Unsaved
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Difference chunk buttons only when comparing revisions */}
          {!isUntrackedOrNew && (
            <>
              {/* Rollback Current Chunk button */}
              <button
                className="jb-btn-secondary"
                onClick={handleRevertCurrentChunk}
                disabled={chunkCount === 0}
                title="Rollback current difference to HEAD"
                style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Undo2 size={12} color="var(--jb-git-modified)" />
                Rollback Change
              </button>

              <button
                className="jb-icon-btn"
                onClick={handlePrevChunk}
                disabled={chunkCount === 0}
                title="Previous Difference (Shift+F7)"
              >
                <ChevronUp size={15} />
              </button>
              <button
                className="jb-icon-btn"
                onClick={handleNextChunk}
                disabled={chunkCount === 0}
                title="Next Difference (F7)"
              >
                <ChevronDown size={15} />
              </button>
              <div style={{ width: '1px', height: '16px', background: 'var(--jb-border)', margin: '0 4px' }} />
            </>
          )}

          {/* Save button */}
          <button
            className="jb-btn-primary"
            onClick={() => handleSave()}
            disabled={!isDirty || isSaving}
            title="Save changes to disk (Cmd+S)"
            style={{ padding: '4px 10px', fontSize: '11px', opacity: isDirty ? 1 : 0.6 }}
          >
            {saveSuccess ? <Check size={13} /> : <Save size={13} />}
            {saveSuccess ? 'Saved' : 'Save'}
          </button>

          {/* Rollback whole file button */}
          <button
            className="jb-icon-btn"
            onClick={onRollback}
            title={isUntrackedOrNew ? 'Delete untracked file' : 'Rollback ENTIRE file (revert working copy)'}
          >
            <RotateCcw size={14} />
          </button>

          {/* Toggle Side-by-side / Unified (only for modified files) */}
          {!isUntrackedOrNew && (
            <>
              <div style={{ width: '1px', height: '16px', background: 'var(--jb-border)', margin: '0 4px' }} />
              <button
                className={`jb-icon-btn ${!isUnified ? 'active' : ''}`}
                onClick={() => setIsUnified(!isUnified)}
                title={isUnified ? 'Switch to Side-by-Side Diff' : 'Switch to Unified Diff'}
              >
                <Columns2 size={14} />
              </button>
            </>
          )}

          {/* Find in Diff button */}
          <div style={{ width: '1px', height: '16px', background: 'var(--jb-border)', margin: '0 4px' }} />
          <button
            className={`jb-icon-btn ${showSearch ? 'active' : ''}`}
            onClick={() => {
              const next = !showSearch;
              setShowSearch(next);
              if (next) {
                setTimeout(() => {
                  searchInputRef.current?.focus();
                  searchInputRef.current?.select();
                }, 50);
              }
            }}
            title="Find in Diff (Cmd+F)"
          >
            <Search size={14} />
          </button>

          {/* Diff Engine Selector */}
          <div style={{ width: '1px', height: '16px', background: 'var(--jb-border)', margin: '0 4px' }} />

        </div>
      </div>

      {/* JetBrains-style Diff Search Bar */}
      {showSearch && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '36px',
            padding: '0 12px',
            background: '#2b2d30',
            borderBottom: '1px solid var(--jb-border)',
            fontSize: '12px',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, maxWidth: '680px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--jb-bg)',
                border: '1px solid var(--jb-border)',
                borderRadius: '4px',
                padding: '2px 8px',
                height: '24px',
                flex: 1,
              }}
            >
              <Search size={13} color="var(--jb-text-dim)" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Find in diff (Enter next, Shift+Enter prev)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) handlePrevMatch();
                    else handleNextMatch();
                  } else if (e.key === 'Escape') {
                    setShowSearch(false);
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
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'none', border: 'none', color: 'var(--jb-text-dim)', cursor: 'pointer', padding: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Scope Pill (Both / Left / Right) */}
            {!isUntrackedOrNew && (
              <div
                style={{
                  display: 'flex',
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: '4px',
                  padding: '1px',
                  border: '1px solid var(--jb-border)',
                }}
              >
                <button
                  className={`jb-scope-btn ${searchScope === 'both' ? 'active' : ''}`}
                  onClick={() => setSearchScope('both')}
                  title="Search in both Left (HEAD) and Right (Working copy)"
                >
                  Both
                </button>
                <button
                  className={`jb-scope-btn ${searchScope === 'left' ? 'active' : ''}`}
                  onClick={() => setSearchScope('left')}
                  title="Search only in Left pane (HEAD / Base)"
                >
                  Left
                </button>
                <button
                  className={`jb-scope-btn ${searchScope === 'right' ? 'active' : ''}`}
                  onClick={() => setSearchScope('right')}
                  title="Search only in Right pane (Local Working Copy)"
                >
                  Right
                </button>
              </div>
            )}

            {/* Match Case Toggle */}
            <button
              className={`jb-icon-btn ${matchCase ? 'active' : ''}`}
              style={{ width: '24px', height: '24px' }}
              onClick={() => setMatchCase(!matchCase)}
              title={matchCase ? 'Match Case (Active)' : 'Match Case'}
            >
              <CaseSensitive size={14} />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* Matches count */}
            <span style={{ fontSize: '11px', color: matches.length > 0 ? 'var(--jb-text-muted)' : 'var(--jb-git-conflict)', minWidth: '70px', textAlign: 'right' }}>
              {searchQuery.trim()
                ? matches.length > 0
                  ? `${currentMatchIndex + 1} of ${matches.length}`
                  : 'No matches'
                : ''}
            </span>

            {/* Prev / Next Match buttons */}
            <button
              className="jb-icon-btn"
              style={{ width: '24px', height: '24px' }}
              onClick={handlePrevMatch}
              disabled={matches.length === 0}
              title="Previous Match (Shift+Enter)"
            >
              <ChevronUp size={14} />
            </button>
            <button
              className="jb-icon-btn"
              style={{ width: '24px', height: '24px' }}
              onClick={handleNextMatch}
              disabled={matches.length === 0}
              title="Next Match (Enter)"
            >
              <ChevronDown size={14} />
            </button>

            {/* Close Search bar */}
            <button
              className="jb-icon-btn"
              style={{ width: '24px', height: '24px' }}
              onClick={() => {
                setShowSearch(false);
                setSearchQuery('');
              }}
              title="Close Search (Escape)"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Pane headers */}
      {isUntrackedOrNew ? (
        <div
          style={{
            display: 'flex',
            height: '24px',
            background: '#232529',
            borderBottom: '1px solid var(--jb-border)',
            fontSize: '11px',
            color: 'var(--jb-text-muted)',
            alignItems: 'center',
            paddingLeft: '12px',
          }}
        >
          <span>Working Tree File (Full Width Editor)</span>
          <span style={{ fontSize: '10px', color: 'var(--jb-accent)', marginLeft: '8px' }}>• Live Edit</span>
        </div>
      ) : !isUnified ? (
        <div
          style={{
            display: 'flex',
            height: '24px',
            background: '#232529',
            borderBottom: '1px solid var(--jb-border)',
            fontSize: '11px',
            color: 'var(--jb-text-muted)',
            alignItems: 'center',
          }}
        >
          <div style={{ flex: 1, paddingLeft: '12px', borderRight: '1px solid var(--jb-border)' }}>
            HEAD (Committed revision)
          </div>
          <div style={{ flex: 1, paddingLeft: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Local Working Copy (Editable)</span>
            <span style={{ fontSize: '10px', color: 'var(--jb-accent)' }}>• Live Edit</span>
          </div>
        </div>
      ) : null}

      {/* Editor Body */}
      {diffEngine === 'codemirror' ? (
        <div
          ref={containerRef}
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        />
      ) : (
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <React.Suspense
            fallback={
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--jb-text-muted)',
                  fontSize: '13px',
                }}
              >
                Loading {diffEngine === 'monaco' ? 'Monaco Editor' : 'UIW CodeMirror'}...
              </div>
            }
          >
            {diffEngine === 'monaco' ? (
              <MonacoEngine
                ref={engineRef}
                filePath={filePath}
                fileStatus={fileStatus}
                original={original}
                modified={currentModified}
                onSave={(val) => {
                  setCurrentModified(val);
                  setIsDirty(true);
                }}
                onSaved={() => handleSave()}
                onRollback={onRollback}
                onDiffCount={setChunkCount}
                isUnified={isUnified}
              />
            ) : (
              <></>
            )}
          </React.Suspense>
        </div>
      )}
    </div>
  );
};
