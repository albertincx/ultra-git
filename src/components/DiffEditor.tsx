import React, { useEffect, useRef, useState } from 'react';
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
import { MergeView, unifiedMergeView, goToNextChunk, goToPreviousChunk } from '@codemirror/merge';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
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
} from 'lucide-react';
import { saveFileContent } from '../api';
import { GitFileStatus } from '../types';

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

  const [currentModified, setCurrentModified] = useState(initialModified);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUnified, setIsUnified] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Chunks info for toolbar
  const [chunkCount, setChunkCount] = useState(0);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);

  // Untracked or brand new file with no HEAD original
  const isUntrackedOrNew = fileStatus === 'untracked' || (!original && fileStatus === 'added');

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
      await saveFileContent(filePath, text);
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

  // Keyboard shortcut: Cmd+S
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filePath, currentModified]);

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
    handleRevertChunk(currentChunkIndex);
  };

  // Next / Previous difference chunk
  const handleNextChunk = () => {
    if (mergeViewRef.current) {
      goToNextChunk(mergeViewRef.current.b);
      setCurrentChunkIndex((prev) => (chunkCount > 0 ? (prev + 1) % chunkCount : 0));
    } else if (unifiedViewRef.current) {
      goToNextChunk(unifiedViewRef.current);
      setCurrentChunkIndex((prev) => (chunkCount > 0 ? (prev + 1) % chunkCount : 0));
    }
  };

  const handlePrevChunk = () => {
    if (mergeViewRef.current) {
      goToPreviousChunk(mergeViewRef.current.b);
      setCurrentChunkIndex((prev) => (chunkCount > 0 ? (prev - 1 + chunkCount) % chunkCount : 0));
    } else if (unifiedViewRef.current) {
      goToPreviousChunk(unifiedViewRef.current);
      setCurrentChunkIndex((prev) => (chunkCount > 0 ? (prev - 1 + chunkCount) % chunkCount : 0));
    }
  };

  // Render Editor / Diff
  useEffect(() => {
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

      // Auto-scroll to first difference chunk
      setTimeout(() => {
        try {
          if (mergeView && mergeView.chunks && mergeView.chunks.length > 0) {
            const firstChunk = mergeView.chunks[0];
            const targetPos = firstChunk.fromB;
            mergeView.b.dispatch({
              selection: { anchor: targetPos },
              effects: EditorView.scrollIntoView(targetPos, { y: 'center' }),
            });
            const block = mergeView.b.lineBlockAt(targetPos);
            if (mergeView.dom && block) {
              mergeView.dom.scrollTop = Math.max(0, block.top - 80);
            }
          }
        } catch (err) {
          console.warn('Auto-scroll to first chunk error:', err);
        }
      }, 70);

      return () => {
        mergeView.destroy();
      };
    }
  }, [filePath, original, initialModified, isUnified, isUntrackedOrNew]);

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
        </div>
      </div>

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
    </div>
  );
};
