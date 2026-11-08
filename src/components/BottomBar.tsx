import React from 'react';
import { Terminal, GitBranch, Layers, FolderGit2, Folder, Search } from 'lucide-react';
import { ProjectTab } from '../types';
import { openInFinder } from '../api';

interface BottomBarProps {
  onOpenTerminal: () => void;
  onToggleFind?: () => void;
  isFindOpen?: boolean;
  findMatchesCount?: number;
  activeProject?: ProjectTab;
  modifiedCount: number;
}

export const BottomBar: React.FC<BottomBarProps> = ({
  onOpenTerminal,
  onToggleFind,
  isFindOpen = false,
  findMatchesCount,
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
        {/* Find Tool Window toggle button */}
        {onToggleFind && (
          <button
            onClick={onToggleFind}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              background: isFindOpen ? 'rgba(53, 116, 240, 0.25)' : 'transparent',
              color: isFindOpen ? '#fff' : 'var(--jb-text)',
              border: isFindOpen ? '1px solid var(--jb-accent)' : '1px solid transparent',
              borderRadius: '3px',
              padding: '2px 7px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: isFindOpen ? 600 : 400,
              transition: 'background 0.1s, color 0.1s',
            }}
            title="Toggle Find in Files Tool Window (Cmd+Shift+F or Ctrl+Shift+F)"
          >
            <Search size={12} color="var(--jb-accent)" />
            <span>Find</span>
            {findMatchesCount !== undefined && findMatchesCount > 0 && (
              <span
                style={{
                  fontSize: '9px',
                  background: 'rgba(234, 179, 8, 0.25)',
                  color: 'var(--jb-git-modified)',
                  padding: '1px 5px',
                  borderRadius: '10px',
                  fontWeight: 700,
                  lineHeight: '1',
                }}
              >
                {findMatchesCount}
              </span>
            )}
            <span
              style={{
                fontSize: '10px',
                color: 'var(--jb-text-dim)',
                marginLeft: '2px',
              }}
            >
              ⇧⌘F
            </span>
          </button>
        )}

        {/* Native macOS Terminal launcher button */}
        <button
          onClick={onOpenTerminal}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            background: 'transparent',
            color: 'var(--jb-text)',
            border: 'none',
            borderRadius: '3px',
            padding: '2px 7px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 400,
            transition: 'background 0.1s, color 0.1s',
          }}
          title="Open Native macOS Terminal in active project (Ctrl+` or Alt+F12)"
        >
          <Terminal size={12} color="var(--jb-accent)" />
          <span>Terminal</span>
          <span
            style={{
              fontSize: '10px',
              color: 'var(--jb-text-dim)',
              marginLeft: '2px',
            }}
          >
            Ctrl+`
          </span>
        </button>

        <div style={{ width: '1px', height: '12px', background: 'var(--jb-border)' }} />

        {/* Git changes indicator */}
        {activeProject?.isGit === false ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--jb-text-dim)' }}>
            <Folder size={11} />
            <span>Folder (no git)</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Layers size={11} color="var(--jb-git-modified)" />
            <span>
              {modifiedCount} file{modifiedCount !== 1 ? 's' : ''} changed
            </span>
          </div>
        )}

        {activeProject?.isGit !== false && activeProject?.branch && activeProject.branch !== 'no git' && (
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: 'var(--jb-text-dim)',
              cursor: 'pointer',
              padding: '1px 5px',
              borderRadius: '3px',
            }}
            onClick={() => activeProject?.repoRoot && openInFinder(activeProject.repoRoot)}
            title={`Open ${activeProject.repoRoot} in Finder`}
          >
            {activeProject.isGit === false ? <Folder size={11} /> : <FolderGit2 size={11} />}
            <span style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeProject.repoName}
            </span>
          </div>
        )}

        <span style={{ color: 'var(--jb-text-dim)' }}>UTF-8</span>
        <span style={{ color: 'var(--jb-text-dim)' }}>LF</span>
        <span style={{ color: 'var(--jb-text-dim)', fontSize: '10px' }}>v1.0.0</span>
      </div>
    </div>
  );
};

