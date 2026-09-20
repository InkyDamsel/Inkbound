export const COMMUNITY_POST_CATEGORIES = [
  'book',
  'music',
  'tv',
  'movie',
  'recommendation',
  'discussion',
  'general',
] as const;

export type CommunityPostCategory = typeof COMMUNITY_POST_CATEGORIES[number];
export type CommunityPostVisibility = 'public' | 'followers';
export type CommunityPostStatus = 'active' | 'hidden' | 'removed';

export interface CommunityBookAttachment {
  bookId: string;
  title: string;
  author: string;
  coverUrl?: string;
}

export interface CommunityPost {
  id: string;
  authorUid: string;
  authorDisplayName: string;
  authorAvatarUrl?: string;
  body: string;
  category: CommunityPostCategory;
  containsSpoilers: boolean;
  containsNsfw: boolean;
  visibility: CommunityPostVisibility;
  status: CommunityPostStatus;
  bookAttachment?: CommunityBookAttachment;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityPostDraft {
  body: string;
  category: CommunityPostCategory;
  containsSpoilers: boolean;
  containsNsfw: boolean;
  visibility: CommunityPostVisibility;
  bookId?: string;
}

export const EMPTY_COMMUNITY_POST_DRAFT: CommunityPostDraft = {
  body: '',
  category: 'book',
  containsSpoilers: false,
  containsNsfw: false,
  visibility: 'public',
};

export const COMMUNITY_CATEGORY_LABELS: Record<CommunityPostCategory, string> = {
  book: 'Books',
  music: 'Music',
  tv: 'TV',
  movie: 'Movies',
  recommendation: 'Recommendations',
  discussion: 'Discussion',
  general: 'General',
};
