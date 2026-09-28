/**
 * Canonical cloud-profile -> runtime-profile projection.
 *
 * Device-local image blobs/media keys are migration/cache details and must never
 * be resurrected by cloud hydration or cross-device reconciliation.
 */
export function compactCloudProfileForRuntime(
  profile: object,
): Record<string, unknown> {
  const compact: Record<string, unknown> = { ...profile };
  delete compact.avatarImageData;
  delete compact.bannerImageData;
  delete compact.avatarMediaKey;
  delete compact.bannerMediaKey;
  return compact;
}
