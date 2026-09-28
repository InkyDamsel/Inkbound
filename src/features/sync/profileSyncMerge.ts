/**
 * Canonical cloud-profile -> runtime-profile projection.
 *
 * Device-local image blobs/media keys are migration/cache details and must never
 * be resurrected by cloud hydration or cross-device reconciliation.
 */
export function compactCloudProfileForRuntime(
  profile: Record<string, unknown>,
): Record<string, unknown> {
  const compact = { ...profile };
  delete compact.avatarImageData;
  delete compact.bannerImageData;
  delete compact.avatarMediaKey;
  delete compact.bannerMediaKey;
  return compact;
}
