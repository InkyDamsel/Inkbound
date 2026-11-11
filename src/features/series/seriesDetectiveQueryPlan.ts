/**
 * Pure planning helpers for Series Detective discovery.
 *
 * Series Detective is read-only: these helpers only decide WHICH catalog
 * queries to ask. They never touch library data.
 */

/** Hard cap on how many individual series positions get their own query. */
export const MAX_POSITION_QUERY_TARGETS = 10;
/** Of those, at most this many may be gaps inside the owned range. */
export const MAX_GAP_QUERY_TARGETS = 5;
/** How many positions past the highest owned book are probed. */
export const FORWARD_QUERY_TARGETS = 5;

export interface SeriesQueryPlanInput {
  seriesName: string;
  author: string;
  /** Series positions already known for books in the library (any numbers). */
  knownPositions: number[];
}

export interface SeriesQueryPlan {
  /** Positions that received dedicated "book N" queries. */
  targetPositions: number[];
  /** De-duplicated catalog queries, base queries first. */
  queries: string[];
}

/**
 * Previously every internal gap and five forward positions each produced two
 * queries, so a 30-book series with one owned book fired ~68 Google Books
 * calls at once. Series-level lookups (Hardcover / Open Library / PRH series
 * expansion and paged author discovery) already cover long series, so the
 * per-position probes are a bounded supplement: gaps nearest the start of the
 * series first, then the next few books after the highest owned position.
 */
export const planSeriesDiscoveryQueries = (input: SeriesQueryPlanInput): SeriesQueryPlan => {
  const seriesName = input.seriesName.trim();
  const author = input.author.trim();

  const wholePositions = input.knownPositions.filter(
    (position) => Number.isInteger(position) && position > 0,
  );
  const highest = wholePositions.length ? Math.max(...wholePositions) : 0;
  const known = new Set(wholePositions);

  const internalGaps = highest > 0
    ? Array.from({ length: highest }, (_, index) => index + 1).filter((position) => !known.has(position))
    : [];
  // A search-led discovery may have no owned numbered installment yet.
  // Probe the opening positions instead of skipping numbered discovery entirely.
  // These are catalog queries, never assumed membership or an asserted series length.
  const forward = Array.from(
    { length: FORWARD_QUERY_TARGETS },
    (_, index) => highest + index + 1,
  );

  const targetPositions = [
    ...internalGaps.slice(0, MAX_GAP_QUERY_TARGETS),
    ...forward,
  ].slice(0, MAX_POSITION_QUERY_TARGETS);

  const positionQueries = targetPositions.flatMap((position) => [
    `"${seriesName}" book ${position}`,
    author ? `${seriesName} book ${position} ${author}` : `${seriesName} book ${position}`,
  ]);

  const baseQueries = [
    `"${seriesName}"`,
    author ? `"${seriesName}" ${author}` : '',
    author ? `${seriesName} ${author}` : '',
    seriesName,
    author ? `inauthor:"${author}" "${seriesName}"` : '',
    // Announced books may lack an ISBN, cover or publication date. These
    // bounded discovery probes ask catalogs for upcoming/untitled listings;
    // the normal identity and series verification gates still decide whether
    // any returned work is eligible for the roster.
    author ? `"${seriesName}" ${author} upcoming` : `"${seriesName}" upcoming`,
    author ? `"${seriesName}" ${author} untitled` : `"${seriesName}" untitled`,
    author ? `"${seriesName}" ${author} preorder` : '',
  ].filter(Boolean);

  return {
    targetPositions,
    queries: [...new Set([...baseQueries, ...positionQueries])],
  };
};

/**
 * Runs `worker` over `items` with at most `limit` calls in flight. Results keep
 * input order. A rejected worker rejects the whole call (callers such as
 * Series Detective's catalog search already swallow non-abort failures).
 */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
};
