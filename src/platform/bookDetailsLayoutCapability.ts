import { useEffect, useState } from 'react';

// The compact Book Details dock is a viewport decision, not a platform decision.
// Small browsers and native WebViews must get the same controls and geometry.
export const BOOK_DETAILS_COMPACT_QUERY =
  '(max-width: 1023px), (orientation: landscape) and (max-height: 600px)';

const isCompactViewport = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia(BOOK_DETAILS_COMPACT_QUERY).matches;

export const usesEmbeddedBookDetailsToolbar = isCompactViewport;

export function useEmbeddedBookDetailsToolbar(): boolean {
  const [compact, setCompact] = useState(isCompactViewport);

  useEffect(() => {
    const query = window.matchMedia(BOOK_DETAILS_COMPACT_QUERY);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return compact;
}
