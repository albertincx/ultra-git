import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Download,
  RotateCw,
  CheckCircle2,
  ExternalLink,
  X,
  AlertCircle,
  Tag,
  Calendar,
  FileText,
} from 'lucide-react';
import { checkAppUpdates, openExternalUrl, UpdateInfo, fetchAppVersion } from '../api';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState<'idle' | 'checking' | 'updated' | 'available' | 'error'>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentVer, setCurrentVer] = useState<string>('1.0.0');

  // Load current version on open
  useEffect(() => {
    if (isOpen) {
      fetchAppVersion().then((info) => {
        if (info?.version) setCurrentVer(info.version);
      }).catch(() => {});
    }
  }, [isOpen]);

  // Close modal on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleCheckUpdates = async () => {
    setStatus('checking');
    setErrorMsg(null);
    try {
      const data = await checkAppUpdates();
      setUpdateInfo(data);
      if (data.currentVersion) {
        setCurrentVer(data.currentVersion);
      }
      if (data.hasUpdate) {
        setStatus('available');
      } else {
        setStatus('updated');
      }
    } catch (err: any) {
      console.error('Update check failed:', err);
      setErrorMsg(err.message || 'Unable to connect to GitHub update service.');
      setStatus('error');
    }
  };

  const handleDownload = () => {
    const url = updateInfo?.downloadUrl || updateInfo?.releaseUrl || 'https://github.com/albertincx/ultra-git/releases';
    openExternalUrl(url);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
        animation: 'jb-menu-fade 0.12s ease-out',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--jb-panel-bg)',
          border: '1px solid var(--jb-border)',
          borderRadius: '8px',
          width: '520px',
          maxWidth: '92vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.7), 0 0 1px rgba(255, 255, 255, 0.15)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--jb-border)',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: 'rgba(53, 116, 240, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--jb-accent)',
              }}
            >
              <Sparkles size={16} />
            </div>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#fff', margin: 0 }}>
                Check for Updates
              </h3>
              <span style={{ fontSize: '11px', color: 'var(--jb-text-dim)' }}>
                ultra Git • Version v{currentVer}
              </span>
            </div>
          </div>

          <button
            className="jb-icon-btn"
            style={{ width: '26px', height: '26px' }}
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
          {/* Status: Idle */}
          {status === 'idle' && (
            <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--jb-text)' }}>
              <div
                style={{
                  width: '54px',
                  height: '54px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.04)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 14px',
                  color: 'var(--jb-accent)',
                }}
              >
                <RotateCw size={26} />
              </div>
              <h4 style={{ fontSize: '14px', color: '#fff', marginBottom: '6px' }}>
                Check for New Releases
              </h4>
              <p style={{ fontSize: '12px', color: 'var(--jb-text-muted)', maxWidth: '360px', margin: '0 auto' }}>
                Currently installed: <b style={{ color: '#fff' }}>v{currentVer}</b>. Click below to check GitHub for updates and new feature builds.
              </p>
            </div>
          )}

          {/* Status: Checking */}
          {status === 'checking' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  border: '3px solid rgba(53, 116, 240, 0.2)',
                  borderTopColor: 'var(--jb-accent)',
                  animation: 'spin 0.8s linear infinite',
                  margin: '0 auto 16px',
                }}
              />
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: '13px', fontWeight: 500, color: '#fff' }}>
                Checking GitHub releases...
              </div>
              <div style={{ fontSize: '11px', color: 'var(--jb-text-dim)', marginTop: '4px' }}>
                Comparing version v{currentVer} with latest repository tags
              </div>
            </div>
          )}

          {/* Status: Updated (No update available) */}
          {status === 'updated' && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div
                style={{
                  width: '54px',
                  height: '54px',
                  borderRadius: '50%',
                  background: 'rgba(74, 222, 128, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 14px',
                  color: 'var(--jb-git-untracked)',
                }}
              >
                <CheckCircle2 size={30} />
              </div>
              <h4 style={{ fontSize: '14px', color: '#fff', marginBottom: '6px' }}>
                ultra Git is Up to Date
              </h4>
              <p style={{ fontSize: '12px', color: 'var(--jb-text-muted)' }}>
                You are running version <b style={{ color: '#fff' }}>v{currentVer}</b>, which is currently the newest available release.
              </p>
            </div>
          )}

          {/* Status: Available (New version found) */}
          {status === 'available' && updateInfo && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Alert Badge */}
              <div
                style={{
                  background: 'rgba(53, 116, 240, 0.12)',
                  border: '1px solid rgba(53, 116, 240, 0.35)',
                  borderRadius: '6px',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: 'var(--jb-accent)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Download size={18} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>
                    New Version Available: v{updateInfo.latestVersion}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--jb-text-muted)', marginTop: '2px' }}>
                    Installed: v{currentVer} ➜ Latest: v{updateInfo.latestVersion}
                  </div>
                </div>
              </div>

              {/* Release Metadata */}
              <div
                style={{
                  background: 'var(--jb-bg)',
                  border: '1px solid var(--jb-border)',
                  borderRadius: '6px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--jb-text)' }}>
                    <Tag size={13} color="var(--jb-accent)" />
                    <span style={{ fontWeight: 600, color: '#fff' }}>
                      {updateInfo.releaseName || `v${updateInfo.latestVersion}`}
                    </span>
                  </div>

                  {updateInfo.publishedAt && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--jb-text-dim)', fontSize: '11px' }}>
                      <Calendar size={12} />
                      <span>{new Date(updateInfo.publishedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>

                {updateInfo.releaseNotes && (
                  <div
                    style={{
                      marginTop: '6px',
                      maxHeight: '140px',
                      overflowY: 'auto',
                      fontSize: '11px',
                      color: 'var(--jb-text-muted)',
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap',
                      background: 'rgba(0, 0, 0, 0.25)',
                      padding: '8px 10px',
                      borderRadius: '4px',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', color: 'var(--jb-text)' }}>
                      <FileText size={11} />
                      <b>Release Notes:</b>
                    </div>
                    {updateInfo.releaseNotes}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status: Error */}
          {status === 'error' && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                padding: '14px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
              }}
            >
              <AlertCircle size={18} color="var(--jb-git-conflict)" style={{ flexShrink: 0, marginTop: '1px' }} />
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>
                  Failed to check for updates
                </div>
                <div style={{ fontSize: '11px', color: 'var(--jb-text-muted)', marginTop: '3px' }}>
                  {errorMsg || 'Could not connect to GitHub. Check your internet connection.'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            borderTop: '1px solid var(--jb-border)',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          {/* Left: View GitHub Releases */}
          <button
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--jb-text-muted)',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: 0,
            }}
            onClick={() => openExternalUrl('https://github.com/albertincx/ultra-git/releases')}
            title="Open releases on GitHub"
          >
            <span>GitHub Releases</span>
            <ExternalLink size={11} />
          </button>

          {/* Right: Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="jb-btn-secondary" onClick={onClose}>
              Close
            </button>

            {/* Check for Updates button */}
            <button
              className={status === 'available' ? 'jb-btn-secondary' : 'jb-btn-primary'}
              disabled={status === 'checking'}
              onClick={handleCheckUpdates}
            >
              <RotateCw size={13} style={{ animation: status === 'checking' ? 'spin 1s linear infinite' : 'none' }} />
              <span>{status === 'checking' ? 'Checking...' : status === 'updated' ? 'Check Again' : 'Check for Updates'}</span>
            </button>

            {/* Download New Version button if versions are not the same */}
            {status === 'available' && (
              <button
                className="jb-btn-primary"
                onClick={handleDownload}
                style={{
                  background: 'var(--jb-git-untracked)',
                  borderColor: 'var(--jb-git-untracked)',
                  fontWeight: 600,
                  boxShadow: '0 2px 8px rgba(115, 201, 145, 0.3)',
                }}
              >
                <Download size={14} />
                <span>Download New Version</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

