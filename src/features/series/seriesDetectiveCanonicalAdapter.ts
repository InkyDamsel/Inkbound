  // Require the same independently corroborated owned work to anchor the
  // requested series. A generic matching series phrase is not enough.
  const anchored = corroboratedOwnedSeed;
  // Count only structured native membership claims, not search mirrors.
  const providers = new Set(matching.map(source => source.seriesProvider ?? source.provider));
  const positions = matching.filter(source => source.position !== null
    && Number.isInteger(source.position) && source.position > 0)
    .map(source => ({ provider: source.seriesProvider ?? source.provider, position: source.position! }));
  const invalidPosition = matching.some(source => source.position !== null
    && (!Number.isSafeInteger(source.position) || source.position <= 0));
  const distinctPositions = new Set(positions.map(item => item.position));
  const conflicting = invalidPosition || distinctPositions.size > 1;
  const agreedPosition = !conflicting && positions.length > 0
    && new Set(positions.map(item => item.provider)).size >= 2
    ? positions[0].position : null;
  // Membership and ordering are distinct evidence. The final decision engine
  // must keep disputed ordering review-only for safe bulk operations.
  return { verified: anchored && providers.size >= 2
    && independentlyCorroborated(matching) && !conflicting,
    agreedPosition, conflicting, providerCount: providers.size };
}
