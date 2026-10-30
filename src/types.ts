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
  lastOpenedAt: number;
}
