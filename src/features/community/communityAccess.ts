import type { User } from 'firebase/auth';

const COMMUNITY_ALLOWED_PROVIDERS = new Set(['password', 'google.com']);

export function hasCommunityAccount(user: User | null | undefined): boolean {
  if (!user || user.isAnonymous) return false;
  return user.providerData.some((provider) => COMMUNITY_ALLOWED_PROVIDERS.has(provider.providerId));
}
