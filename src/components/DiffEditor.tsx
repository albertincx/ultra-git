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
import { MergeView, unifiedMergeView, getChunks, Chunk } from '@codemirror/merge';
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
  FolderSearch,
  GitCompare,
  FileEdit,
} from 'lucide-react';
import { saveFileContent, openInFinder } from '../api';
import { GitFileStatus } from '../types';
import { DiffEngineType, DiffEngineHandle } from './diff-engines/types';

const MonacoEngine = React.lazy(() => import('./diff-engines/MonacoEngine'));

interface DiffEditorProps {
  filePath: string;
  fileStatus?: GitFileStatus;
  original: string;
  modified: string;
  mode?: 'diff' | 'editor';
  onToggleMode?: () => void;
  onSaved: () => void;
  onRollback: () => void;
  compareTitle?: string;
  leftLabel?: string;
  rightLabel?: string;
  preferredEngine?: DiffEngineType;
  onEngineChange?: (engine: DiffEngineType) => void;
  jumpToLine?: { line: number; column?: number; length?: number } | null;
}

// Custom Gutter Marker for rolling back individual chunk
class RollbackGutterMarker extends GutterMarker {
  constructor(public onRevert: () => void, public isCompareMode: boolean = false) {
    super();
  }

  toDOM() {
    const btn = document.createElement('button');
    btn.className = 'jb-gutter-revert-btn';
    btn.title = this.isCompareMode ? 'Copy this change from left to right' : 'Rollback this change (revert to HEAD)';
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
  mode = 'diff',
  onToggleMode,
  onSaved,
  onRollback,
  compareTitle,
  leftLabel,
  rightLabel,
  preferredEngine,
  onEngineChange,
  jumpToLine,
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

  // Untracked or brand new file with no HEAD original, or user opened file from File Explorer
  const isUntrackedOrNew = !compareTitle && (fileStatus === 'untracked' || (!original && fileStatus === 'added'));
  const isEditorOnly = !compareTitle && (mode === 'editor' || isUntrackedOrNew);

  // Sync content when switching files
  useEffect(() => {
    setCurrentModified(initialModified);
    setIsDirty(false);
  }, [filePath, initialModified]);

  // Immediate reset chunk count if editor only
  useEffect(() => {
    if (isEditorOnly) {
      setChunkCount(0);
    }
  }, [isEditorOnly]);

  // Diff Engine state
  const [diffEngine, setDiffEngine] = useState<DiffEngineType>(() => {
    if (preferredEngine) return preferredEngine;
    if (compareTitle) {
      const dirSaved = localStorage.getItem('ultra_dir_diff_engine');
      if (dirSaved === 'codemirror') return 'codemirror';
      return 'monaco';
    }
    const saved = localStorage.getItem('ultra_diff_engine');
    if (saved === 'monaco') return 'monaco';
    return 'codemirror';
  });

  useEffect(() => {
    if (preferredEngine && preferredEngine !== diffEngine) {
      setDiffEngine(preferredEngine);
    }
  }, [preferredEngine]);

  const handleEngineChange = (engine: DiffEngineType) => {
    setDiffEngine(engine);
    if (compareTitle) {
      localStorage.setItem('ultra_dir_diff_engine', engine);
    } else {
      localStorage.setItem('ultra_diff_engine', engine);
    }
    onEngineChange?.(engine);
  };

  // Jump to specific line/column (e.g. from Find in Files)
  useEffect(() => {
    if (!jumpToLine) return;
    const { line, column = 1, length = 0 } = jumpToLine;

    const performJump = (view: EditorView) => {
      try {
        if (line <= view.state.doc.lines) {
          const lineInfo = view.state.doc.line(line);
          const from = Math.min(lineInfo.from + Math.max(0, column - 1), lineInfo.to);
          const to = Math.min(from + Math.max(0, length), lineInfo.to);
          view.dispatch({
            selection: { anchor: from, head: to },
            effects: EditorView.scrollIntoView(from, { y: 'center' }),
            userEvent: 'select',
          });
          view.focus();

          if (view.scrollDOM) {
            const block = view.lineBlockAt(from);
            if (block) {
              const h = view.scrollDOM.clientHeight || 400;
              view.scrollDOM.scrollTo({ top: Math.max(0, block.top - Math.round(h / 3)), behavior: 'smooth' });
            }
          }
        }
      } catch (e) {
        console.warn('performJump error:', e);
      }
    };

    const timer = setTimeout(() => {
      if (mergeViewRef.current) {
        const mv = mergeViewRef.current;
        performJump(mv.b);
        if (mv.dom) {
          try {
            const lineInfo = mv.b.state.doc.line(Math.min(line, mv.b.state.doc.lines));
            const block = mv.b.lineBlockAt(lineInfo.from);
            if (block) {
              const h = mv.dom.clientHeight || 400;
              mv.dom.scrollTo({ top: Math.max(0, block.top - Math.round(h / 3)), behavior: 'smooth' });
            }
          } catch {}
        }
      } else if (singleEditorRef.current) {
        performJump(singleEditorRef.current);
      } else if (unifiedViewRef.current) {
        performJump(unifiedViewRef.current);
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [jumpToLine, diffEngine]);

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
    const target = path.includes(' ↔ ') ? path.split(' ↔ ')[1].trim() : path.trim();
    if (target.endsWith('.json')) return json();
    if (
      target.endsWith('.js') ||
      target.endsWith('.jsx') ||
      target.endsWith('.ts') ||
      target.endsWith('.tsx')
    ) {
      return javascript({ typescript: true, jsx: true });
    }
    return [];
  };

  const handleSave = async (contentToSave?: string) => {
    let text = contentToSave;
    if (text === undefined) {
      if (diffEngine === 'codemirror') {
        if (mergeViewRef.current) {
          text = mergeViewRef.current.b.state.doc.toString();
        } else if (singleEditorRef.current) {
          text = singleEditorRef.current.state.doc.toString();
        } else if (unifiedViewRef.current) {
          text = unifiedViewRef.current.state.doc.toString();
        }
      }
      if (text === undefined) {
        text = currentModified;
      }
    }

    setIsSaving(true);
    try {
      const targetSavePath = filePath.includes(' ↔ ') ? filePath.split(' ↔ ')[1].trim() : filePath.trim();
      await saveFileContent(targetSavePath, text);
      setCurrentModified(text);
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

  // Global Ctrl+S / Cmd+S handler
  useEffect(() => {
    const handleGlobalSaveKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleGlobalSaveKey, true);
    return () => window.removeEventListener('keydown', handleGlobalSaveKey, true);
  }, [diffEngine, filePath, currentModified]);

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

  // Scroll directly to a specific diff chunk
  const scrollToChunkIndex = useCallback((index: number) => {
    if (mergeViewRef.current) {
      const mv = mergeViewRef.current;
      const chunks = mv.chunks;
      if (!chunks || chunks.length === 0) return;
      const safeIndex = ((index % chunks.length) + chunks.length) % chunks.length;
      setCurrentChunkIndex(safeIndex);
      const chunk = chunks[safeIndex];
      if (!chunk) return;

      const posB = chunk.fromB;
      const endB = Math.max(chunk.fromB, chunk.toB);
      const posA = chunk.fromA;
      const endA = Math.max(chunk.fromA, chunk.toA);

      // Select in Editor B and Editor A
      try {
        mv.b.dispatch({
          selection: { anchor: posB, head: Math.min(endB, mv.b.state.doc.length) },
          effects: EditorView.scrollIntoView(posB, { y: 'center' }),
          userEvent: 'select.byChunk',
        });
        mv.a.dispatch({
          selection: { anchor: posA, head: Math.min(endA, mv.a.state.doc.length) },
          effects: EditorView.scrollIntoView(posA, { y: 'center' }),
          userEvent: 'select.byChunk',
        });
      } catch (e) {
        console.warn('Dispatch selection error:', e);
      }

      // Smooth scroll container to center the chunk
      try {
        const blockB = posB <= mv.b.state.doc.length ? mv.b.lineBlockAt(posB) : null;
        const blockA = posA <= mv.a.state.doc.length ? mv.a.lineBlockAt(posA) : null;
        const blockTop = blockB ? blockB.top : blockA ? blockA.top : null;

        if (blockTop !== null) {
          if (mv.dom) {
            const h = mv.dom.clientHeight || 400;
            const targetTop = Math.max(0, blockTop - Math.round(h / 3));
            mv.dom.scrollTo({ top: targetTop, behavior: 'smooth' });
          }
          if (mv.b.scrollDOM && mv.b.scrollDOM !== mv.dom) {
            const h = mv.b.scrollDOM.clientHeight || 400;
            const targetTop = Math.max(0, blockTop - Math.round(h / 3));
            mv.b.scrollDOM.scrollTo({ top: targetTop, behavior: 'smooth' });
          }
        }
      } catch (err) {
        console.warn('Scroll to chunk DOM error:', err);
      }
    } else if (unifiedViewRef.current) {
      const view = unifiedViewRef.current;
      const chunkInfo = getChunks(view.state);
      const chunks = chunkInfo?.chunks;
      if (!chunks || chunks.length === 0) return;
      const safeIndex = ((index % chunks.length) + chunks.length) % chunks.length;
      setCurrentChunkIndex(safeIndex);
      const chunk = chunks[safeIndex];
      if (!chunk) return;

      const pos = chunk.fromB;
      const end = Math.max(chunk.fromB, chunk.toB);

      try {
        view.dispatch({
          selection: { anchor: pos, head: Math.min(end, view.state.doc.length) },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
          userEvent: 'select.byChunk',
        });
      } catch (e) {
        console.warn('Dispatch unified selection error:', e);
      }

      try {
        if (view.scrollDOM) {
          const block = view.lineBlockAt(Math.min(pos, view.state.doc.length));
          if (block) {
            const h = view.scrollDOM.clientHeight || 400;
            const targetTop = Math.max(0, block.top - Math.round(h / 3));
            view.scrollDOM.scrollTo({ top: targetTop, behavior: 'smooth' });
          }
        }
      } catch (err) {
        console.warn('Scroll in unified view error:', err);
      }
    }
  }, []);

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
      let total = 0;
      if (mergeViewRef.current) {
        total = mergeViewRef.current.chunks?.length || 0;
      } else if (unifiedViewRef.current) {
        total = getChunks(unifiedViewRef.current.state)?.chunks?.length || 0;
      }
      if (total > 0) {
        const next = (currentChunkIndex + 1) % total;
        scrollToChunkIndex(next);
      }
    }
  };

  const handlePrevChunk = () => {
    if (diffEngine === 'monaco' && engineRef.current) {
      engineRef.current.prevDiff();
    } else if (diffEngine === 'codemirror') {
      let total = 0;
      if (mergeViewRef.current) {
        total = mergeViewRef.current.chunks?.length || 0;
      } else if (unifiedViewRef.current) {
        total = getChunks(unifiedViewRef.current.state)?.chunks?.length || 0;
      }
      if (total > 0) {
        const prev = (currentChunkIndex - 1 + total) % total;
        scrollToChunkIndex(prev);
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

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: (view) => {
          handleSave(view.state.doc.toString());
          return true;
        },
      },
      {
        key: 'Ctrl-s',
        run: (view) => {
          handleSave(view.state.doc.toString());
          return true;
        },
      },
    ]);

    // 1. Untracked / Brand New File OR Editor Mode: Render Single Full-Width Editor
    if (isEditorOnly) {
      setChunkCount(0);
      const state = EditorState.create({
        doc: initialModified,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          saveKeymap,
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
          saveKeymap,
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

      const chunkInfo = getChunks(view.state);
      const total = chunkInfo?.chunks?.length || 0;
      setChunkCount(total);

      setTimeout(() => {
        scrollToChunkIndex(0);
      }, 70);

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
                      marker: new RollbackGutterMarker(() => handleRevertChunk(i), Boolean(compareTitle)),
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
            saveKeymap,
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
          btn.title = compareTitle ? 'Copy this change from left to right' : 'Rollback this change (revert to HEAD)';
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
            scrollToChunkIndex(0);
          }
        } catch (err) {
          console.warn('Auto-scroll to first chunk error:', err);
        }
      }, 70);

      return () => {
        mergeView.destroy();
      };
    }
  }, [diffEngine, filePath, original, initialModified, isUnified, isEditorOnly]);

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
          <span
            style={{ fontWeight: 600, color: 'var(--jb-text)', cursor: 'pointer' }}
            onClick={() => openInFinder(filePath)}
            title="Click to reveal in Finder"
          >
            {compareTitle || filePath}
          </span>
          <button
            className="jb-icon-btn"
            style={{ width: '22px', height: '22px' }}
            onClick={() => openInFinder(filePath)}
            title="Open in Finder"
          >
            <FolderSearch size={13} />
          </button>

          {compareTitle ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                background: 'rgba(86, 168, 245, 0.2)',
                color: 'var(--jb-accent)',
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '3px',
                fontWeight: 600,
              }}
            >
              <GitCompare size={10} />
              Compare Mode
            </span>
          ) : isUntrackedOrNew ? (
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
          ) : isEditorOnly ? (
            <span
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'var(--jb-text)',
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '3px',
                fontWeight: 500,
              }}
            >
              Editor Mode
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
              {chunkCount > 0 ? `${currentChunkIndex + 1} of ${chunkCount}` : '0'} difference{chunkCount !== 1 ? 's' : ''}
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
          {/* If opened from Explorer as editor, allow switching to Diff if original exists */}
          {mode === 'editor' && original && original !== currentModified && onToggleMode && (
            <button
              className="jb-btn-secondary"
              onClick={onToggleMode}
              title="Compare with HEAD (Open Diff)"
              style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <GitCompare size={12} color="var(--jb-git-modified)" />
              Compare with HEAD
            </button>
          )}

          {/* If in Diff mode, allow switching to full Editor */}
          {mode === 'diff' && !isUntrackedOrNew && onToggleMode && (
            <button
              className="jb-btn-secondary"
              onClick={onToggleMode}
              title="Switch to Full Width Editor"
              style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <FileEdit size={12} />
              Full Editor
            </button>
          )}

          {/* Difference chunk buttons only when comparing revisions in Diff mode */}
          {!isEditorOnly && (
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

          {/* Toggle Side-by-side / Unified (only for modified files in Diff mode) */}
          {!isEditorOnly && (
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
          <div
            style={{
              display: 'inline-flex',
              background: 'rgba(0, 0, 0, 0.25)',
              borderRadius: '4px',
              padding: '2px',
              gap: '2px',
              alignItems: 'center',
            }}
          >
            <button
              onClick={() => handleEngineChange('codemirror')}
              title="CodeMirror 6 (Fast, <10ms)"
              style={{
                background: diffEngine === 'codemirror' ? 'var(--jb-accent)' : 'transparent',
                color: diffEngine === 'codemirror' ? '#fff' : 'var(--jb-text-dim)',
                border: 'none',
                borderRadius: '3px',
                padding: '2px 7px',
                fontSize: '10px',
                fontWeight: diffEngine === 'codemirror' ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Fast (CM6)
            </button>
            <button
              onClick={() => handleEngineChange('monaco')}
              title="Monaco Editor (VS Code engine)"
              style={{
                background: diffEngine === 'monaco' ? 'var(--jb-accent)' : 'transparent',
                color: diffEngine === 'monaco' ? '#fff' : 'var(--jb-text-dim)',
                border: 'none',
                borderRadius: '3px',
                padding: '2px 7px',
                fontSize: '10px',
                fontWeight: diffEngine === 'monaco' ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Monaco
            </button>
          </div>

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
      {isEditorOnly ? (
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
          <span>{isUntrackedOrNew ? 'Untracked File' : 'Working Copy File'} (Full Width Editor)</span>
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
          <div style={{ flex: 1, paddingLeft: '12px', borderRight: '1px solid var(--jb-border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {leftLabel || 'HEAD (Committed revision)'}
          </div>
          {diffEngine === 'codemirror' && (
            <div
              style={{
                width: '26px',
                flexShrink: 0,
                background: '#232529',
                borderRight: '1px solid var(--jb-border)',
                height: '100%',
              }}
            />
          )}
          <div style={{ flex: 1, paddingLeft: '12px', display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {rightLabel || 'Local Working Copy (Editable)'}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--jb-accent)', flexShrink: 0 }}>• Live Edit</span>
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
                mode={mode}
                onSave={(val) => {
                  setCurrentModified(val);
                  setIsDirty(true);
                }}
                onSaved={(val?: string) => handleSave(val)}
                onRollback={onRollback}
                onDiffCount={setChunkCount}
                isUnified={isUnified}
                jumpToLine={jumpToLine}
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
