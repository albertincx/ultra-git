import { GitFileStatus } from '../../types';

export type DiffEngineType = 'codemirror' | 'monaco' | 'uiw';

export interface DiffEngineProps {
  filePath: string;
  fileStatus?: GitFileStatus;
  original: string;
  modified: string;
  onSave: (newContent: string) => void;
  onSaved: () => void;
  onRollback: () => void;
  isUnified?: boolean;
}
