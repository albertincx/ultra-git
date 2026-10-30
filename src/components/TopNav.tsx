import React, { useState } from 'react';
import { GitBranch, FolderGit2, RotateCw } from 'lucide-react';

interface TopNavProps {
  repoName: string;
  repoPath: string;
  branch: string;
  onRefresh: () => void;
  onOpenRepo: (newPath: string) => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  repoName,
  repoPath,
  branch,
  onRefresh,
  onOpenRepo,
}) => {
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [inputPath, setInputPath] = useState(repoPath);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '40px',
        padding: '0 16px 0 80px', // 80px left padding for macOS traffic lights
        background: '#2b2d30',
        borderBottom: '1px solid var(--jb-border)',
        WebkitAppRegion: 'drag', // Allows dragging native macOS window!
      } as React.CSSProperties}
    >
      {/* Left: Project & Branch */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <FolderGit2 size={16} color="var(--jb-accent)" />
          {isEditingPath ? (
            <input
              type="text"
              className="jb-input"
              style={{ width: '280px', padding: '2px 6px', fontSize: '11px' }}
              value={inputPath}
              autoFocus
              onChange={(e) => setInputPath(e.target.value)}
              onBlur={() => setIsEditingPath(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onOpenRepo(inputPath);
                  setIsEditingPath(false);
                } else if (e.key === 'Escape') {
                  setIsEditingPath(false);
                }
              }}
            />
          ) : (
            <span
              style={{ fontWeight: 600, fontSize: '13px', color: '#fff', cursor: 'pointer' }}
              title={`Click to change repo path: ${repoPath}`}
              onClick={() => {
                setInputPath(repoPath);
                setIsEditingPath(true);
              }}
            >
              {repoName || 'Ultra Git'}
            </span>
          )}
        </div>

        {/* Branch pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'rgba(255, 255, 255, 0.06)',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            color: 'var(--jb-text)',
            border: '1px solid var(--jb-border)',
          }}
        >
          <GitBranch size={12} color="var(--jb-git-modified)" />
          <span style={{ fontWeight: 500 }}>{branch || 'main'}</span>
        </div>
      </div>

      {/* Right controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <button className="jb-icon-btn" onClick={onRefresh} title="Refresh Git Status">
          <RotateCw size={14} />
        </button>
      </div>
    </div>
  );
};
