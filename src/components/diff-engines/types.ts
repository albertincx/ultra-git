import { GitFileStatus } from '../../types';

export type DiffEngineType = 'codemirror' | 'monaco' | 'uiw';

export interface DiffEngineHandle {
  nextDiff: () => void;
  prevDiff: () => void;
  revertCurrentDiff: () => void;
}

export interface DiffEngineProps {
  filePath: string;
  fileStatus?: GitFileStatus;
  original: string;
  modified: string;
  mode?: 'diff' | 'editor';
  onSave: (newContent: string) => void;
  onSaved: () => void;
  onRollback: () => void;
  onDiffCount?: (count: number) => void;
  isUnified?: boolean;
  jumpToLine?: { line: number; column?: number; length?: number } | null;
}
