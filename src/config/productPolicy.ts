export type FeatureTier = 'free' | 'premium';
export type ProductFeature =
  | 'batchEdit'
  | 'detailedReports'
  | 'advancedInsights'
  | 'monthlyWrapped'
  | 'yearInBooks'
  | 'bookshelfThroughTime'
  | 'seriesCore'
  | 'seriesInsights'
  | 'collections'
  | 'readingProgress'
  | 'readingCalendar'
  | 'studio'
  | 'completeExport';

const featurePolicy: Record<ProductFeature, FeatureTier> = {
  // Basic library cleanup is core data management. Readers should never need
  // Premium just to correct imported status, ownership, format, or type in bulk.
  batchEdit: 'free',
  detailedReports: 'premium',
  advancedInsights: 'premium',
  monthlyWrapped: 'premium',
  yearInBooks: 'premium',
  bookshelfThroughTime: 'premium',
  seriesCore: 'free',
  seriesInsights: 'premium',
  collections: 'free',
  readingProgress: 'free',
  readingCalendar: 'free',
  studio: 'free',
  completeExport: 'free',
};

const subscriptionsOpen = import.meta.env.VITE_PREMIUM_SUBSCRIPTIONS_OPEN === 'true';

export const PRODUCT_POLICY = {
  library: {
    freeItemLimit: Infinity,
    unlimitedImports: true,
    dataExportIncluded: true,
  },
  premium: {
    subscriptionsOpen,
    plannedMonthlyPrice: 6.99,
    plannedAnnualPrice: 59.99,
  },
  features: featurePolicy,
} as const;

export const isFeatureAvailableToFree = (feature: ProductFeature) => PRODUCT_POLICY.features[feature] === 'free';

export const PREMIUM_FEATURE_SUMMARY = [
  'Advanced reading insights and detailed reports',
  'Monthly Wrapped and Year in Books reflections',
  'Bookshelf Through Time and deeper reading-history views',
  'Deeper Series Insights',
] as const;

export const PREMIUM_UPGRADE_REASON = 'Premium adds advanced insights, Wrapped, Year in Books, deeper Series Insights, and historical shelf views.';
