import { logEvent } from 'firebase/analytics';
import { analyticsReady } from '../../lib/firebase';

type AnalyticsParameter = string | number | boolean;
type AnalyticsParameters = Record<string, AnalyticsParameter>;

const SAFE_EVENT_NAME = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Central privacy boundary for Inkbound product analytics.
 *
 * Callers may report feature/action metadata only. Never send titles, authors,
 * ISBNs, search text, email addresses, notes, tags, collection names, or other
 * reader/library content through analytics.
 */
export function trackInkboundEvent(
  eventName: string,
  parameters: AnalyticsParameters = {},
): void {
  if (!SAFE_EVENT_NAME.test(eventName)) return;

  void analyticsReady.then((analytics) => {
    if (!analytics) return;
    try {
      logEvent(analytics, eventName, parameters);
    } catch (error) {
      console.warn('Inkbound analytics event could not be recorded.', error);
    }
  });
}
