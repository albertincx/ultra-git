import React, { useRef, useImperativeHandle, forwardRef, useEffect } from 'react';
import * as monaco from 'monaco-editor';
import { DiffEditor as MonacoDiffEditor, Editor as MonacoEditor, loader } from '@monaco-editor/react';
import { DiffEngineProps, DiffEngineHandle } from './types';

// Configure Monaco Web Worker via standard Vite new URL() worker resolution
if (typeof window !== 'undefined') {
  (window as any).MonacoEnvironment = {
    getWorker: function (_moduleId: any, _label: string) {
      return new Worker(
        new URL('../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
        { type: 'module' }
      );
    },
  };
}

// Configure monaco-editor from local bundle so it does not fetch from external CDN
loader.config({ monaco });

// Define high-contrast JetBrains-style theme for Monaco diff
monaco.editor.defineTheme('jb-dark-diff', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'diffEditor.insertedTextBackground': '#2e7d3255',
    'diffEditor.removedTextBackground': '#b71c1c55',
    'diffEditor.insertedLineBackground': '#1e3b2b40',
    'diffEditor.removedLineBackground': '#3b1e1e40',
    'diffEditorGutter.insertedLineBackground': '#2e7d3288',
    'diffEditorGutter.removedLineBackground': '#b71c1c88',
    'diffEditor.diagonalFill': '#2b2d30',
  },
});

function getLanguage(filePath: string): string {
  const target = filePath.includes(' ↔ ') ? filePath.split(' ↔ ')[1].trim() : filePath.trim();
  const ext = target.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'json':
      return 'json';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'go':
      return 'go';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'md':
      return 'markdown';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'sql':
      return 'sql';
    default:
      return 'plaintext';
  }
}

export const MonacoEngine = forwardRef<DiffEngineHandle, DiffEngineProps>(
  (
    {
      filePath,
      fileStatus,
      original,
      modified,
      mode = 'diff',
      onSave,
      onSaved,
      onDiffCount,
      isUnified = false,
      jumpToLine,
    },
    ref
  ) => {
    const isSingleEditor = mode === 'editor' || fileStatus === 'untracked' || (!original && fileStatus === 'added');
    const language = getLanguage(filePath);
    const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
    const singleEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

    // Jump to line when requested (e.g. from Find in Files)
    useEffect(() => {
      if (!jumpToLine) return;
      const timer = setTimeout(() => {
        const ed = singleEditorRef.current || diffEditorRef.current?.getModifiedEditor();
        if (ed) {
          ed.revealLineInCenter(jumpToLine.line);
          const col = jumpToLine.column || 1;
          ed.setPosition({ lineNumber: jumpToLine.line, column: col });
          if (jumpToLine.length) {
            ed.setSelection({
              startLineNumber: jumpToLine.line,
              startColumn: col,
              endLineNumber: jumpToLine.line,
              endColumn: col + jumpToLine.length,
            });
          }
          ed.focus();
        }
      }, 80);
      return () => clearTimeout(timer);
    }, [jumpToLine]);

    // Revert current diff chunk
    const handleRevertCurrentDiff = () => {
      const editor = diffEditorRef.current;
      if (!editor) return;

      const lineChanges = editor.getLineChanges();
      if (!lineChanges || lineChanges.length === 0) return;

      const modifiedEditor = editor.getModifiedEditor();
      const originalEditor = editor.getOriginalEditor();
      const pos = modifiedEditor.getPosition();
      const currentLine = pos?.lineNumber || 1;

      // Find change at current line or closest
      let change = lineChanges.find(
        (c) =>
          currentLine >= c.modifiedStartLineNumber &&
          currentLine <= (c.modifiedEndLineNumber || c.modifiedStartLineNumber)
      );
      if (!change) {
        change =
          lineChanges.find((c) => c.modifiedStartLineNumber >= currentLine) || lineChanges[0];
      }

      // Try native widget revert
      if (typeof (editor as any).revert === 'function') {
        try {
          (editor as any).revert(change);
          setTimeout(() => {
            const val = modifiedEditor.getValue();
            onSave(val);
            onSaved();
          }, 40);
          return;
        } catch (e) {
          console.warn('Monaco native revert failed, using manual fallback', e);
        }
      }

      // Manual revert fallback
      const origModel = originalEditor.getModel();
      const modModel = modifiedEditor.getModel();
      if (!origModel || !modModel) return;

      const origText =
        change.originalEndLineNumber >= change.originalStartLineNumber &&
        change.originalStartLineNumber > 0
          ? origModel.getValueInRange({
              startLineNumber: change.originalStartLineNumber,
              startColumn: 1,
              endLineNumber: change.originalEndLineNumber,
              endColumn: origModel.getLineMaxColumn(change.originalEndLineNumber),
            })
          : '';

      if (
        change.modifiedEndLineNumber >= change.modifiedStartLineNumber &&
        change.modifiedStartLineNumber > 0
      ) {
        modifiedEditor.executeEdits('revert', [
          {
            range: new monaco.Range(
              change.modifiedStartLineNumber,
              1,
              change.modifiedEndLineNumber,
              modModel.getLineMaxColumn(change.modifiedEndLineNumber)
            ),
            text: origText,
          },
        ]);
      } else if (change.modifiedStartLineNumber > 0) {
        const insLine = Math.min(change.modifiedStartLineNumber, modModel.getLineCount());
        modifiedEditor.executeEdits('revert', [
          {
            range: new monaco.Range(insLine, 1, insLine, 1),
            text: origText ? origText + '\n' : '',
          },
        ]);
      }

      const newVal = modModel.getValue();
      onSave(newVal);
      onSaved();
    };

    useImperativeHandle(ref, () => ({
      nextDiff: () => {
        diffEditorRef.current?.goToDiff('next');
      },
      prevDiff: () => {
        diffEditorRef.current?.goToDiff('previous');
      },
      revertCurrentDiff: handleRevertCurrentDiff,
    }));

    const handleDiffMount = (
      editor: monaco.editor.IStandaloneDiffEditor,
      monacoInstance: typeof monaco
    ) => {
      diffEditorRef.current = editor;
      const modifiedEditor = editor.getModifiedEditor();

      // Listen for text edits in modified editor
      modifiedEditor.onDidChangeModelContent(() => {
        const val = modifiedEditor.getValue();
        onSave(val);
      });

      // Save on Cmd+S / Ctrl+S
      modifiedEditor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
        onSaved();
      });

      const updateDiffInfo = () => {
        const changes2 = (editor as any).getDiffComputationResult?.()?.changes2;
        if (changes2 && changes2.length > 0) {
          onDiffCount?.(changes2.length);
          return changes2.length;
        }
        const changes = editor.getLineChanges();
        if (changes !== null && changes !== undefined) {
          onDiffCount?.(changes.length);
          return changes.length;
        }
        return null;
      };

      // When diff computation updates, report chunk count and scroll to first difference
      editor.onDidUpdateDiff(() => {
        const count = updateDiffInfo();
        if (count && count > 0) {
          editor.revealFirstDiff();
        }
      });

      // Periodic check for diff calculation results
      let checks = 0;
      const timer = setInterval(() => {
        checks++;
        const count = updateDiffInfo();
        if (count !== null && count > 0) {
          editor.revealFirstDiff();
          clearInterval(timer);
        } else if (checks > 20) {
          clearInterval(timer);
        }
      }, 100);
    };

    const handleSingleMount = (
      editor: monaco.editor.IStandaloneCodeEditor,
      monacoInstance: typeof monaco
    ) => {
      singleEditorRef.current = editor;

      editor.onDidChangeModelContent(() => {
        const val = editor.getValue();
        onSave(val);
      });

      editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
        onSaved();
      });

      onDiffCount?.(0);
    };

    // When filePath, original, or modified changes, refresh diff info
    useEffect(() => {
      const editor = diffEditorRef.current;
      if (!editor) return;

      const checkDiff = () => {
        const changes2 = (editor as any).getDiffComputationResult?.()?.changes2;
        if (changes2 && changes2.length > 0) {
          onDiffCount?.(changes2.length);
          editor.revealFirstDiff();
          return true;
        }
        const changes = editor.getLineChanges();
        if (changes !== null && changes !== undefined) {
          onDiffCount?.(changes.length);
          if (changes.length > 0) {
            editor.revealFirstDiff();
          }
          return true;
        }
        return false;
      };

      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (checkDiff() || attempts > 25) {
          clearInterval(interval);
        }
      }, 100);

      return () => clearInterval(interval);
    }, [filePath, original, modified]);

    if (isSingleEditor) {
      return (
        <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
          <MonacoEditor
            key={`${filePath}_${mode}`}
            height="100%"
            language={language}
            value={modified}
            theme="jb-dark-diff"
            onMount={handleSingleMount}
            options={{
              automaticLayout: true,
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              minimap: { enabled: true },
            }}
          />
        </div>
      );
    }

    const safePath = encodeURIComponent(filePath.replace(/[^a-zA-Z0-9_-]/g, '_'));

    // Dispose existing models with same URIs if they exist to prevent model collision
    useEffect(() => {
      const origUri = monaco.Uri.parse(`inmemory://model/${safePath}/original`);
      const modUri = monaco.Uri.parse(`inmemory://model/${safePath}/modified`);
      const m1 = monaco.editor.getModel(origUri);
      if (m1) m1.dispose();
      const m2 = monaco.editor.getModel(modUri);
      if (m2) m2.dispose();
    }, [safePath]);

    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <MonacoDiffEditor
          key={`${safePath}_${isUnified}`}
          height="100%"
          language={language}
          original={original}
          modified={modified}
          originalModelPath={`inmemory://model/${safePath}/original`}
          modifiedModelPath={`inmemory://model/${safePath}/modified`}
          theme="jb-dark-diff"
          onMount={handleDiffMount}
          options={{
            renderSideBySide: !isUnified,
            readOnly: false,
            originalEditable: false,
            automaticLayout: true,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            diffCodeLens: true,
            renderMarginRevertIcon: true,
            ignoreTrimWhitespace: false,
            renderIndicators: true,
            renderOverviewRuler: true,
            diffAlgorithm: 'advanced',
            minimap: { enabled: true },
          }}
        />
      </div>
    );
  }
);

MonacoEngine.displayName = 'MonacoEngine';

export default MonacoEngine;
