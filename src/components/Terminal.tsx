import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Terminal as TerminalIcon,
  Plus,
  X,
  Trash2,
  Square,
  Maximize2,
  Minimize2,
  CornerDownLeft,
  RotateCw,
  GitBranch,
  Copy,
  Check,
  Folder,
} from 'lucide-react';
import { executeTerminalStream, killTerminalProcess, fetchTerminalInfo, resetTerminalCwd } from '../api';

interface TerminalTab {
  id: string;
  title: string;
  cwd: string;
  history: string[];
  historyIndex: number;
  output: TerminalEntry[];
  isRunning: boolean;
  activeExecId: string | null;
}

interface TerminalEntry {
  id: string;
  type: 'command' | 'output' | 'error' | 'system';
  text: string;
  cwd?: string;
  timestamp?: string;
  exitCode?: number;
}

interface TerminalProps {
  repoRoot?: string;
  repoName?: string;
  branch?: string;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
}

const ANSI_COLORS: Record<number, string> = {
  30: '#64748b', // Black / Dark Slate
  31: '#f87171', // Red
  32: '#4ade80', // Green
  33: '#facc15', // Yellow
  34: '#60a5fa', // Blue
  35: '#c084fc', // Magenta
  36: '#38bdf8', // Cyan
  37: '#f1f5f9', // White
  90: '#94a3b8', // Bright Black / Gray
  91: '#ef4444', // Bright Red
  92: '#22c55e', // Bright Green
  93: '#eab308', // Bright Yellow
  94: '#3b82f6', // Bright Blue
  95: '#a855f7', // Bright Magenta
  96: '#06b6d4', // Bright Cyan
  97: '#ffffff', // Bright White
};

function cleanAndRenderAnsi(rawText: string): React.ReactNode {
  // Strip non-color ANSI codes (cursor movement, clear line, etc.)
  const text = rawText.replace(/\x1b\[([0-9;]*)[A-HJKSTfhilmn]/g, (fullMatch, _codes, char) => {
    return char === 'm' ? fullMatch : '';
  });

  const regex = /\x1b\[([0-9;]*)m/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let currentColor: string | undefined;
  let isBold = false;
  let isDim = false;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const segment = text.slice(lastIndex, match.index);
    if (segment) {
      elements.push(
        <span
          key={elements.length}
          style={{
            color: currentColor,
            fontWeight: isBold ? 600 : 400,
            opacity: isDim ? 0.75 : 1,
          }}
        >
          {segment}
        </span>
      );
    }

    const codeStr = match[1] || '0';
    const codes = codeStr.split(';').map((c) => parseInt(c, 10) || 0);

    for (const code of codes) {
      if (code === 0) {
        currentColor = undefined;
        isBold = false;
        isDim = false;
      } else if (code === 1) {
        isBold = true;
      } else if (code === 2) {
        isDim = true;
      } else if (code === 22) {
        isBold = false;
        isDim = false;
      } else if (code === 39) {
        currentColor = undefined;
      } else if (ANSI_COLORS[code]) {
        currentColor = ANSI_COLORS[code];
      }
    }

    lastIndex = regex.lastIndex;
  }

  const remaining = text.slice(lastIndex);
  if (remaining) {
    elements.push(
      <span
        key={elements.length}
        style={{
          color: currentColor,
          fontWeight: isBold ? 600 : 400,
          opacity: isDim ? 0.75 : 1,
        }}
      >
        {remaining}
      </span>
    );
  }

  return elements.length > 0 ? elements : text;
}

const QUICK_COMMANDS = [
  'git status',
  'git diff',
  'git log --oneline -10',
  'git branch -a',
  'ls -la',
  'clear',
];

export const Terminal: React.FC<TerminalProps> = ({
  repoRoot = '',
  repoName = 'Project',
  branch = 'main',
  isMaximized,
  onToggleMaximize,
  onClose,
}) => {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    {
      id: 'term_1',
      title: 'Local',
      cwd: repoRoot,
      history: [],
      historyIndex: -1,
      output: [
        {
          id: 'welcome',
          type: 'system',
          text: `⚡ ultra Superlight Terminal connected [${repoName}]`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ],
      isRunning: false,
      activeExecId: null,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('term_1');
  const [inputVal, setInputVal] = useState('');
  const [copied, setCopied] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeAbortRef = useRef<AbortController | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Update default tab cwd when repoRoot changes
  useEffect(() => {
    if (repoRoot) {
      setTabs((prev) =>
        prev.map((t) => (t.cwd === '' || !t.cwd ? { ...t, cwd: repoRoot } : t))
      );
    }
  }, [repoRoot]);

  // Auto-scroll output container to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [activeTab?.output, scrollToBottom]);

  // Focus input whenever user clicks inside terminal
  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  // Add output line to active tab
  const appendOutput = useCallback((tabId: string, entry: Omit<TerminalEntry, 'id'>) => {
    const id = 'out_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) return tab;
        return {
          ...tab,
          output: [...tab.output, { ...entry, id }],
        };
      })
    );
  }, []);

  // Update last output line (useful for streaming chunks)
  const appendChunkToLastOutput = useCallback((tabId: string, chunk: string, isError = false) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) return tab;
        const last = tab.output[tab.output.length - 1];
        if (last && last.type === (isError ? 'error' : 'output')) {
          const updatedLast: TerminalEntry = {
            ...last,
            text: last.text + chunk,
          };
          return {
            ...tab,
            output: [...tab.output.slice(0, -1), updatedLast],
          };
        } else {
          const newEntry: TerminalEntry = {
            id: 'out_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type: isError ? 'error' : 'output',
            text: chunk,
          };
          return {
            ...tab,
            output: [...tab.output, newEntry],
          };
        }
      })
    );
  }, []);

  // Execute a command in active tab
  const runCommand = async (rawCmd: string) => {
    const cmd = rawCmd.trim();
    if (!cmd || !activeTab || activeTab.isRunning) return;

    setInputVal('');

    // Update command history
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTab.id) return tab;
        const filteredHistory = tab.history.filter((h) => h !== cmd);
        return {
          ...tab,
          history: [...filteredHistory, cmd],
          historyIndex: -1,
        };
      })
    );

    // Client-side 'clear' command
    if (cmd === 'clear' || cmd === 'cls') {
      setTabs((prev) =>
        prev.map((tab) => (tab.id === activeTab.id ? { ...tab, output: [] } : tab))
      );
      return;
    }

    // Add command header entry
    appendOutput(activeTab.id, {
      type: 'command',
      text: cmd,
      cwd: activeTab.cwd,
      timestamp: new Date().toLocaleTimeString(),
    });

    const execId = 'exec_' + Date.now();
    const abortCtrl = new AbortController();
    activeAbortRef.current = abortCtrl;

    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTab.id
          ? { ...tab, isRunning: true, activeExecId: execId }
          : tab
      )
    );

    try {
      await executeTerminalStream(cmd, {
        sessionId: activeTab.id,
        cwd: activeTab.cwd,
        execId,
        signal: abortCtrl.signal,
        onStdout: (text) => {
          appendChunkToLastOutput(activeTab.id, text, false);
        },
        onStderr: (text) => {
          appendChunkToLastOutput(activeTab.id, text, true);
        },
        onExit: (code, newCwd) => {
          setTabs((prev) =>
            prev.map((tab) => {
              if (tab.id !== activeTab.id) return tab;
              const nextCwd = newCwd || tab.cwd;
              const outputWithExit = [...tab.output];
              if (code !== 0) {
                outputWithExit.push({
                  id: 'exit_' + Date.now(),
                  type: 'system',
                  text: `Command exited with code ${code}`,
                  exitCode: code,
                });
              }
              return {
                ...tab,
                cwd: nextCwd,
                isRunning: false,
                activeExecId: null,
                output: outputWithExit,
              };
            })
          );
        },
        onError: (err) => {
          appendOutput(activeTab.id, {
            type: 'error',
            text: err,
          });
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTab.id
                ? { ...tab, isRunning: false, activeExecId: null }
                : tab
            )
          );
        },
      });
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        appendOutput(activeTab.id, {
          type: 'error',
          text: e.message || 'Execution error',
        });
      }
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id
            ? { ...tab, isRunning: false, activeExecId: null }
            : tab
        )
      );
    } finally {
      activeAbortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // Stop / Kill currently running command
  const handleStopCommand = async () => {
    if (!activeTab || !activeTab.isRunning) return;
    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
    }
    if (activeTab.activeExecId) {
      await killTerminalProcess(activeTab.activeExecId);
    }
    appendOutput(activeTab.id, {
      type: 'system',
      text: '^C (Process interrupted)',
    });
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTab.id
          ? { ...tab, isRunning: false, activeExecId: null }
          : tab
      )
    );
  };

  // Input Key Navigation (Enter, Up, Down, Tab, Ctrl+C, Ctrl+L)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runCommand(inputVal);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!activeTab || activeTab.history.length === 0) return;
      const history = activeTab.history;
      const nextIndex =
        activeTab.historyIndex === -1
          ? history.length - 1
          : Math.max(0, activeTab.historyIndex - 1);
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id ? { ...tab, historyIndex: nextIndex } : tab
        )
      );
      setInputVal(history[nextIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!activeTab || activeTab.historyIndex === -1) return;
      const history = activeTab.history;
      const nextIndex = activeTab.historyIndex + 1;
      if (nextIndex >= history.length) {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTab.id ? { ...tab, historyIndex: -1 } : tab
          )
        );
        setInputVal('');
      } else {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTab.id ? { ...tab, historyIndex: nextIndex } : tab
          )
        );
        setInputVal(history[nextIndex]);
      }
    } else if (e.key === 'c' && (e.ctrlKey || (e.metaKey && !inputVal))) {
      // Ctrl+C interrupts running command or clears input
      if (activeTab.isRunning) {
        e.preventDefault();
        handleStopCommand();
      } else if (inputVal) {
        e.preventDefault();
        setInputVal('');
      }
    } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      // Ctrl+L clears output
      e.preventDefault();
      setTabs((prev) =>
        prev.map((tab) => (tab.id === activeTab.id ? { ...tab, output: [] } : tab))
      );
    }
  };

  // New Tab creation
  const handleNewTab = () => {
    const nextNum = tabs.length + 1;
    const newTab: TerminalTab = {
      id: 'term_' + Date.now(),
      title: `Local (${nextNum})`,
      cwd: repoRoot,
      history: [],
      historyIndex: -1,
      output: [
        {
          id: 'welcome_' + Date.now(),
          type: 'system',
          text: `⚡ ultra Superlight Terminal session ${nextNum} opened`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ],
      isRunning: false,
      activeExecId: null,
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTab.id);
  };

  // Close Tab
  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length <= 1) return;
    const index = tabs.findIndex((t) => t.id === id);
    const updated = tabs.filter((t) => t.id !== id);
    setTabs(updated);
    if (activeTabId === id) {
      const nextActive = updated[Math.max(0, index - 1)];
      setActiveTabId(nextActive.id);
    }
  };

  // Clear Output
  const handleClearOutput = () => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === activeTab.id ? { ...tab, output: [] } : tab))
    );
  };

  // Copy whole terminal output
  const handleCopyOutput = () => {
    if (!activeTab) return;
    const fullText = activeTab.output.map((o) => o.text).join('\n');
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Format cwd to compact relative format
  const formatCwd = (cwd: string) => {
    if (!cwd) return repoName;
    if (repoRoot && cwd.startsWith(repoRoot)) {
      const rel = cwd.slice(repoRoot.length).replace(/^[/\\]/, '');
      return rel ? `${repoName}/${rel}` : repoName;
    }
    // Outside repo, replace home dir with ~
    return cwd.replace(/^\/Users\/[^/]+/, '~');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: '#191a1d',
        color: '#d1d5db',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '12px',
        overflow: 'hidden',
        borderTop: '1px solid var(--jb-border)',
      }}
      onClick={handleContainerClick}
    >
      {/* Terminal Header Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '34px',
          background: 'var(--jb-header-bg)',
          borderBottom: '1px solid var(--jb-border)',
          padding: '0 8px',
          userSelect: 'none',
          flexShrink: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Tab list */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflowX: 'auto' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0 6px',
              marginRight: '4px',
              color: 'var(--jb-accent)',
            }}
          >
            <TerminalIcon size={14} />
            <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--jb-text)' }}>
              Terminal
            </span>
          </div>

          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  background: isActive ? 'var(--jb-bg)' : 'transparent',
                  color: isActive ? '#fff' : 'var(--jb-text-muted)',
                  border: isActive ? '1px solid var(--jb-border)' : '1px solid transparent',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: isActive ? 500 : 400,
                  transition: 'background 0.1s',
                }}
              >
                {tab.isRunning && (
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: 'var(--jb-accent)',
                      display: 'inline-block',
                      animation: 'pulse 1.2s infinite',
                    }}
                  />
                )}
                <span>{tab.title}</span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => handleCloseTab(tab.id, e)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--jb-text-dim)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title="Close Terminal"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })}

          <button
            className="jb-icon-btn"
            style={{ width: '22px', height: '22px' }}
            onClick={handleNewTab}
            title="New Terminal Session"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Middle: Quick Action Chips */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            overflowX: 'auto',
            padding: '0 8px',
          }}
        >
          {QUICK_COMMANDS.map((qc) => (
            <button
              key={qc}
              onClick={() => runCommand(qc)}
              disabled={activeTab.isRunning}
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: 'var(--jb-text-muted)',
                borderRadius: '3px',
                padding: '2px 6px',
                fontSize: '10px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                transition: 'all 0.1s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--jb-text)';
                e.currentTarget.style.borderColor = 'var(--jb-accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--jb-text-muted)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
              }}
              title={`Run "${qc}"`}
            >
              {qc}
            </button>
          ))}
        </div>

        {/* Right Toolbar Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          {activeTab.isRunning && (
            <button
              className="jb-btn-secondary"
              onClick={handleStopCommand}
              title="Stop running process (Ctrl+C)"
              style={{
                height: '22px',
                padding: '0 6px',
                fontSize: '11px',
                color: 'var(--jb-git-conflict)',
                borderColor: 'rgba(248, 113, 113, 0.3)',
              }}
            >
              <Square size={11} fill="currentColor" />
              Stop
            </button>
          )}

          <button
            className="jb-icon-btn"
            style={{ width: '24px', height: '24px' }}
            onClick={handleCopyOutput}
            title={copied ? 'Copied!' : 'Copy Terminal Output'}
          >
            {copied ? <Check size={13} color="var(--jb-git-untracked)" /> : <Copy size={13} />}
          </button>

          <button
            className="jb-icon-btn"
            style={{ width: '24px', height: '24px' }}
            onClick={handleClearOutput}
            title="Clear Terminal (Ctrl+L)"
          >
            <Trash2 size={13} />
          </button>

          <button
            className="jb-icon-btn"
            style={{ width: '24px', height: '24px' }}
            onClick={onToggleMaximize}
            title={isMaximized ? 'Restore Terminal' : 'Maximize Terminal'}
          >
            {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          <button
            className="jb-icon-btn"
            style={{ width: '24px', height: '24px' }}
            onClick={onClose}
            title="Close Terminal (Ctrl+`)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Terminal Output Log Area */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          lineHeight: '1.5',
          cursor: 'text',
        }}
      >
        {activeTab.output.map((entry) => {
          if (entry.type === 'command') {
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '8px',
                  marginBottom: '2px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: 'var(--jb-git-modified)',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  <span style={{ color: 'var(--jb-git-untracked)' }}>➜</span>
                  <span>{formatCwd(entry.cwd || activeTab.cwd)}</span>
                  <span style={{ color: 'var(--jb-text-dim)' }}>({branch})</span>
                  <span style={{ color: '#fff' }}>$</span>
                </div>
                <span style={{ color: '#ffffff', fontWeight: 600 }}>{entry.text}</span>
                {entry.timestamp && (
                  <span style={{ fontSize: '10px', color: 'var(--jb-text-dim)', marginLeft: 'auto' }}>
                    {entry.timestamp}
                  </span>
                )}
              </div>
            );
          } else if (entry.type === 'system') {
            return (
              <div
                key={entry.id}
                style={{
                  color: entry.exitCode && entry.exitCode !== 0 ? 'var(--jb-git-conflict)' : 'var(--jb-text-dim)',
                  fontSize: '11px',
                  fontStyle: 'italic',
                  padding: '1px 0',
                }}
              >
                {entry.text}
              </div>
            );
          } else {
            return (
              <div
                key={entry.id}
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: entry.type === 'error' ? 'var(--jb-git-conflict)' : '#d1d5db',
                }}
              >
                {cleanAndRenderAnsi(entry.text)}
              </div>
            );
          }
        })}

        {/* Prompt Input Line */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '4px',
            paddingBottom: '6px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: 'var(--jb-git-modified)',
              fontSize: '11px',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            <span style={{ color: 'var(--jb-git-untracked)' }}>➜</span>
            <span>{formatCwd(activeTab.cwd)}</span>
            <span style={{ color: 'var(--jb-text-dim)' }}>({branch})</span>
            <span style={{ color: '#fff' }}>$</span>
          </div>

          <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
            <input
              ref={inputRef}
              type="text"
              value={inputVal}
              disabled={activeTab.isRunning}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeTab.isRunning ? 'Running process...' : 'Type command and press Enter...'}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#ffffff',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '12px',
                padding: 0,
                caretColor: 'var(--jb-accent)',
              }}
              autoFocus
            />
          </div>
        </div>
      </div>
    </div>
  );
};

