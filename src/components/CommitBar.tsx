import React, { useState } from 'react';
import { GitCommit, Check } from 'lucide-react';

interface CommitBarProps {
  checkedCount: number;
  onCommit: (message: string) => Promise<void>;
}

export const CommitBar: React.FC<CommitBarProps> = ({ checkedCount, onCommit }) => {
  const [message, setMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);

  const handleCommit = async () => {
    if (!message.trim() || checkedCount === 0 || isCommitting) return;
    setIsCommitting(true);
    try {
      await onCommit(message.trim());
      setMessage('');
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--jb-border)',
        padding: '10px 12px',
        background: 'var(--jb-header-bg)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--jb-text-muted)' }}>
          Commit Message
        </span>
        <span style={{ fontSize: '11px', color: 'var(--jb-text-dim)' }}>
          {checkedCount} file{checkedCount !== 1 ? 's' : ''} selected
        </span>
      </div>

      <textarea
        className="jb-input"
        style={{
          width: '100%',
          height: '64px',
          resize: 'none',
          fontSize: '12px',
          fontFamily: 'inherit',
          padding: '6px 8px',
          lineHeight: '1.4',
        }}
        placeholder="Commit description (Cmd+Enter to commit)..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleCommit();
          }
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <button
          className="jb-btn-primary"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={!message.trim() || checkedCount === 0 || isCommitting}
          onClick={handleCommit}
          title="Commit selected changes (Cmd+Enter)"
        >
          <GitCommit size={14} />
          {isCommitting ? 'Committing...' : `Commit (${checkedCount})`}
        </button>
      </div>
    </div>
  );
};
