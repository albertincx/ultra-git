export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'conflict' | 'renamed';

export interface GitFile {
  path: string;
  origPath?: string;
  status: GitFileStatus;
  staged: boolean;
  workTreeStatus: string;
  indexStatus: string;
}

export interface Changelist {
  id: string;
  name: string;
  comment?: string;
  isDefault: boolean;
  filePaths: string[];
}

export interface ChangelistState {
  activeId: string;
  changelists: Changelist[];
}

export interface ShelfItem {
  id: string;
  description: string;
  createdAt: string;
  patchFile: string;
  files: { path: string; isUntracked: boolean }[];
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  file?: GitFile;
  children?: TreeNode[];
}

export interface ProjectTab {
  id: string;
  repoRoot: string;
  repoName: string;
  branch: string;
  isGit?: boolean;
}

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  gitStatus?: GitFileStatus;
}

export interface RecentProject {
  repoRoot: string;
  repoName: string;
  branch: string;
  isGit?: boolean;
  lastOpenedAt: number;
}

export type DirCompareStatus = 'different' | 'left_only' | 'right_only' | 'same';

export interface DirCompareItem {
  relPath: string;
  name: string;
  status: DirCompareStatus;
  size1: number | null;
  size2: number | null;
  mtime1: number | null;
  mtime2: number | null;
}

export interface DirCompareResult {
  dir1: string;
  dir2: string;
  items: DirCompareItem[];
  summary: {
    total: number;
    different: number;
    leftOnly: number;
    rightOnly: number;
    same: number;
  };
}

export interface SearchMatch {
  line: number;
  column: number;
  endColumn: number;
  matchText: string;
  lineText: string;
}

export interface SearchFileResult {
  filePath: string;
  fileName: string;
  dirPath: string;
  matches: SearchMatch[];
}

export interface SearchResult {
  query: string;
  totalMatches: number;
  totalFiles: number;
  files: SearchFileResult[];
  durationMs: number;
  truncated?: boolean;
}

export interface SearchOptions {
  query: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  isRegex?: boolean;
  fileMask?: string;
  scope?: string;
  repoRoot?: string;
}
