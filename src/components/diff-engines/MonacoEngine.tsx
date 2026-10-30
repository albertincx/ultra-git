import React, { useRef } from 'react';
import * as monaco from 'monaco-editor';
import { DiffEditor as MonacoDiffEditor, Editor as MonacoEditor, loader } from '@monaco-editor/react';
import { DiffEngineProps } from './types';

// Configure monaco-editor from local bundle so it does not fetch from external CDN
loader.config({ monaco });

function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
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

export const MonacoEngine: React.FC<DiffEngineProps> = ({
  filePath,
  fileStatus,
  original,
  modified,
  onSave,
  onSaved,
  isUnified = false,
}) => {
  const isUntrackedOrNew = fileStatus === 'untracked' || (!original && fileStatus === 'added');
  const language = getLanguage(filePath);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const singleEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleDiffMount = (editor: monaco.editor.IStandaloneDiffEditor, monacoInstance: typeof monaco) => {
    diffEditorRef.current = editor;
    const modifiedEditor = editor.getModifiedEditor();

    modifiedEditor.onDidChangeModelContent(() => {
      const val = modifiedEditor.getValue();
      onSave(val);
    });

    // Save on Cmd+S / Ctrl+S
    modifiedEditor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      onSaved();
    });
  };

  const handleSingleMount = (editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: typeof monaco) => {
    singleEditorRef.current = editor;

    editor.onDidChangeModelContent(() => {
      const val = editor.getValue();
      onSave(val);
    });

    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      onSaved();
    });
  };

  if (isUntrackedOrNew) {
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <MonacoEditor
          height="100%"
          language={language}
          value={modified}
          theme="vs-dark"
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

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <MonacoDiffEditor
        height="100%"
        language={language}
        original={original}
        modified={modified}
        theme="vs-dark"
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
          minimap: { enabled: true },
        }}
      />
    </div>
  );
};

export default MonacoEngine;
