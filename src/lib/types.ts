export type GroupKind = "bookmark" | "github";

export interface Group {
  id: string;
  kind: GroupKind;
  name: string;
  sortOrder: number;
  isPublic: boolean;
}

export interface Bookmark {
  id: string;
  groupId: string;
  title: string;
  url: string;
  description: string | null;
  faviconUrl: string | null;
  tags: string[];
  sortOrder: number;
  isPublic: boolean;
}

export interface GithubStar {
  id: string;
  githubRepoId: number;
  groupId: string | null;
  fullName: string;
  displayName: string | null;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  starsCount: number;
  ownerAvatarUrl: string | null;
  tags: string[];
  note: string | null;
  sortOrder: number;
  isPublic: boolean;
  isActive: boolean;
  starredAt: string | null;
  syncedAt: string | null;
  repoUpdatedAt: string | null;
}

export interface BookmarkGroup extends Group {
  items: Bookmark[];
}

export interface GithubGroup extends Group {
  items: GithubStar[];
}
