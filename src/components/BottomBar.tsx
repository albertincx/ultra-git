import React from 'react';
import { Terminal, GitBranch, Layers, FolderGit2 } from 'lucide-react';
import { ProjectTab } from '../types';

interface BottomBarProps {
  isTerminalOpen: boolean;
  onToggleTerminal: () => void;
  activeProject?: ProjectTab;
  modifiedCount: number;
}

export const BottomBar: React.FC<BottomBarProps> = ({
  isTerminalOpen,
  onToggleTerminal,
  activeProject,
  modifiedCount,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '24px',
        background: '#2b2d30',
        borderTop: '1px solid var(--jb-border)',
        padding: '0 8px',
        fontSize: '11px',
        color: 'var(--jb-text-muted)',
        userSelect: 'none',
        flexShrink: 0,
        zIndex: 50,
      }}
    >
      {/* Left tool window toggles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Terminal toggle button */}
        <button
          onClick={onToggleTerminal}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            background: isTerminalOpen ? 'var(--jb-selection-bg)' : 'transparent',
            color: isTerminalOpen ? '#ffffff' : 'var(--jb-text)',
            border: 'none',
            borderRadius: '3px',
            padding: '2px 7px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: isTerminalOpen ? 600 : 400,
            transition: 'background 0.1s, color 0.1s',
          }}
          title="Toggle Terminal (Ctrl+` or Alt+F12)"
        >
          <Terminal size={12} color={isTerminalOpen ? 'var(--jb-accent)' : 'currentColor'} />
          <span>Terminal</span>
          <span
            style={{
              fontSize: '10px',
              color: isTerminalOpen ? 'rgba(255, 255, 255, 0.7)' : 'var(--jb-text-dim)',
              marginLeft: '2px',
            }}
          >
            Ctrl+`
          </span>
        </button>

        <div style={{ width: '1px', height: '12px', background: 'var(--jb-border)' }} />

        {/* Git changes indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Layers size={11} color="var(--jb-git-modified)" />
          <span>
            {modifiedCount} file{modifiedCount !== 1 ? 's' : ''} changed
          </span>
        </div>

        {activeProject?.branch && (
          <>
            <div style={{ width: '1px', height: '12px', background: 'var(--jb-border)' }} />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: 'var(--jb-git-modified)',
              }}
            >
              <GitBranch size={11} />
              <span>{activeProject.branch}</span>
            </div>
          </>
        )}
      </div>

      {/* Right status info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {activeProject?.repoName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--jb-text-dim)' }}>
            <FolderGit2 size={11} />
            <span style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeProject.repoName}
            </span>
          </div>
        )}

        <span style={{ color: 'var(--jb-text-dim)' }}>UTF-8</span>
        <span style={{ color: 'var(--jb-text-dim)' }}>LF</span>
      </div>
    </div>
  );
};

