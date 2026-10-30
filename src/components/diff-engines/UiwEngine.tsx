import React, { useRef, useEffect } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { DiffEngineProps } from './types';

function getLanguageExtension(filePath: string) {
  if (filePath.endsWith('.json')) return [json()];
  if (
    filePath.endsWith('.js') ||
    filePath.endsWith('.jsx') ||
    filePath.endsWith('.ts') ||
    filePath.endsWith('.tsx')
  ) {
    return [javascript({ typescript: true, jsx: true })];
  }
  return [];
}

export const UiwEngine: React.FC<DiffEngineProps> = ({
  filePath,
  fileStatus,
  original,
  modified,
  onSave,
  onSaved,
  isUnified = false,
}) => {
  const isUntrackedOrNew = fileStatus === 'untracked' || (!original && fileStatus === 'added');
  const langExt = getLanguageExtension(filePath);

  const leftRef = useRef<ReactCodeMirrorRef>(null);
  const rightRef = useRef<ReactCodeMirrorRef>(null);
  const isSyncing = useRef(false);

  // Synchronize scrolling between left and right editors
  useEffect(() => {
    if (isUnified || isUntrackedOrNew) return;

    const leftScroller = leftRef.current?.view?.scrollDOM;
    const rightScroller = rightRef.current?.view?.scrollDOM;

    if (!leftScroller || !rightScroller) return;

    const onLeftScroll = () => {
      if (isSyncing.current) return;
      isSyncing.current = true;
      rightScroller.scrollTop = leftScroller.scrollTop;
      rightScroller.scrollLeft = leftScroller.scrollLeft;
      requestAnimationFrame(() => {
        isSyncing.current = false;
      });
    };

    const onRightScroll = () => {
      if (isSyncing.current) return;
      isSyncing.current = true;
      leftScroller.scrollTop = rightScroller.scrollTop;
      leftScroller.scrollLeft = rightScroller.scrollLeft;
      requestAnimationFrame(() => {
        isSyncing.current = false;
      });
    };

    leftScroller.addEventListener('scroll', onLeftScroll, { passive: true });
    rightScroller.addEventListener('scroll', onRightScroll, { passive: true });

    return () => {
      leftScroller.removeEventListener('scroll', onLeftScroll);
      rightScroller.removeEventListener('scroll', onRightScroll);
    };
  }, [isUnified, isUntrackedOrNew]);

  // Handle Cmd+S keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        onSaved();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSaved]);

  if (isUntrackedOrNew || isUnified) {
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <CodeMirror
          ref={rightRef}
          value={modified}
          height="100%"
          theme={oneDark}
          extensions={langExt}
          onChange={(val) => onSave(val)}
          style={{ height: '100%', fontSize: '13px' }}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Left side: Original (HEAD) */}
      <div
        style={{
          flex: 1,
          height: '100%',
          overflow: 'hidden',
          borderRight: '1px solid var(--jb-border)',
        }}
      >
        <CodeMirror
          ref={leftRef}
          value={original}
          height="100%"
          readOnly={true}
          editable={false}
          theme={oneDark}
          extensions={langExt}
          style={{ height: '100%', fontSize: '13px' }}
        />
      </div>

      {/* Right side: Modified (Working Copy) */}
      <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
        <CodeMirror
          ref={rightRef}
          value={modified}
          height="100%"
          theme={oneDark}
          extensions={langExt}
          onChange={(val) => onSave(val)}
          style={{ height: '100%', fontSize: '13px' }}
        />
      </div>
    </div>
  );
};

export default UiwEngine;
