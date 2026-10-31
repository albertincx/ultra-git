import React, { useState, useEffect } from 'react';
import { Archive, Clock, File, Play, Trash2, RotateCcw, FolderSearch, Copy } from 'lucide-react';
import { ShelfItem } from '../types';
import { openInFinder } from '../api';

interface ShelfViewProps {
  shelfItems: ShelfItem[];
  selectedShelfId: string | null;
  onSelectShelf: (id: string) => void;
  onUnshelve: (id: string, keepInShelf: boolean) => void;
  onDeleteShelf: (id: string) => void;
  onSelectShelfFile: (shelfId: string, filePath: string) => void;
  onRefresh: () => void;
}

export const ShelfView: React.FC<ShelfViewProps> = ({
  shelfItems,
  selectedShelfId,
  onSelectShelf,
  onUnshelve,
  onDeleteShelf,
  onSelectShelfFile,
  onRefresh,
}) => {
  const [keepInShelf, setKeepInShelf] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, []);

  const selectedItem = shelfItems.find((s) => s.id === selectedShelfId) || shelfItems[0];

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Shelf Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '32px',
          padding: '0 8px',
          background: 'var(--jb-header-bg)',
          borderBottom: '1px solid var(--jb-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className="jb-btn-primary"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            disabled={!selectedItem}
            onClick={() => selectedItem && onUnshelve(selectedItem.id, keepInShelf)}
            title="Apply shelved patch to working tree"
          >
            <Play size={11} fill="currentColor" />
            Unshelve
          </button>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: 'var(--jb-text-muted)',
              cursor: 'pointer',
              marginLeft: '6px',
            }}
          >
            <input
              type="checkbox"
              checked={keepInShelf}
              onChange={(e) => setKeepInShelf(e.target.checked)}
            />
            Keep in shelf
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button
            className="jb-icon-btn"
            disabled={!selectedItem}
            onClick={() => selectedItem && onDeleteShelf(selectedItem.id)}
            title="Delete this shelf item"
          >
            <Trash2 size={13} />
          </button>
          <button className="jb-icon-btn" onClick={onRefresh} title="Refresh Shelf">
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {/* Shelf Items List (Top Half) */}
      <div
        style={{
          height: '45%',
          overflowY: 'auto',
          borderBottom: '1px solid var(--jb-border)',
          background: 'var(--jb-bg)',
        }}
      >
        {shelfItems.length === 0 ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--jb-text-dim)',
              fontSize: '12px',
            }}
          >
            <Archive size={28} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
            <div>No shelved changes</div>
            <div style={{ fontSize: '11px', marginTop: '4px' }}>
              Select changes in Local Changes and click Shelve
            </div>
          </div>
        ) : (
          shelfItems.map((item) => {
            const isSelected = (selectedShelfId || shelfItems[0]?.id) === item.id;
            return (
              <div
                key={item.id}
                style={{
                  padding: '6px 12px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                  background: isSelected ? 'var(--jb-selection-bg)' : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => onSelectShelf(item.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--jb-text)' }}>
                    {item.description}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--jb-text-dim)' }}>
                    {item.files.length} file{item.files.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    color: 'var(--jb-text-dim)',
                    marginTop: '2px',
                  }}
                >
                  <Clock size={11} />
                  <span>{formatDate(item.createdAt)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Files in Selected Shelf (Bottom Half) */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0', background: '#232529' }}>
        <div
          style={{
            padding: '4px 12px',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--jb-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Shelved Files
        </div>

        {selectedItem?.files.map((f) => (
          <div
            key={f.path}
            style={{
              display: 'flex',
              alignItems: 'center',
              height: '24px',
              padding: '0 12px',
              cursor: 'pointer',
              fontSize: '12px',
              color: 'var(--jb-git-modified)',
            }}
            onClick={() => onSelectShelfFile(selectedItem.id, f.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const x = Math.min(e.clientX, window.innerWidth - 210);
              const y = Math.min(e.clientY, window.innerHeight - 100);
              setContextMenu({ x, y, path: f.path });
            }}
            className="jb-tree-row"
          >
            <File size={13} style={{ marginRight: '6px', color: 'var(--jb-text-muted)' }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {f.path}
            </span>
          </div>
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="jb-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="jb-menu-item"
            onClick={async () => {
              setContextMenu(null);
              try {
                await openInFinder(contextMenu.path);
              } catch (e: any) {
                alert(e.message || 'Failed to open in Finder');
              }
            }}
          >
            <FolderSearch size={14} color="var(--jb-accent)" />
            <span>Reveal in Finder</span>
          </div>

          <div className="jb-menu-separator" />

          <div
            className="jb-menu-item"
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.path);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>Copy Path</span>
          </div>
        </div>
      )}
    </div>
  );
};
