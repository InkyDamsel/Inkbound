export const COMMUNITY_PRODUCT_BOUNDARIES = {
  anonymousPosting: false,
  directMessages: false,
  imageUploads: false,
  videoUploads: false,
  liveChat: false,
  locationSharing: false,
} as const;

/**
 * Intentional permanent product boundaries for Inkbound Community.
 *
 * Community is designed around accountable, text-first conversation. These
 * capabilities are not part of the roadmap and should not be introduced by UI,
 * persistence, or backend work without an explicit product decision to change
 * this policy.
 */
export const COMMUNITY_IS_TEXT_ONLY = true;
