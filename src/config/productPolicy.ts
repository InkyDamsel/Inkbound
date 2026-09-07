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
  batchEdit: 'premium',
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

export const PRODUCT_POLICY = {
  library: {
    freeItemLimit: Infinity,
    unlimitedImports: true,
    dataExportIncluded: true,
  },
  premium: {
    subscriptionsOpen: false,
    plannedMonthlyPrice: 6.99,
    plannedAnnualPrice: 59.99,
  },
  features: featurePolicy,
} as const;

export const isFeatureAvailableToFree = (feature: ProductFeature) => PRODUCT_POLICY.features[feature] === 'free';

export const PREMIUM_FEATURE_SUMMARY = [
  'Batch editing for faster library cleanup',
  'Advanced reading insights and detailed reports',
  'Monthly Wrapped and Year in Books reflections',
  'Bookshelf Through Time and deeper reading-history views',
  'Deeper Series Insights',
] as const;

export const PREMIUM_UPGRADE_REASON = 'Premium adds advanced insights, batch editing, Wrapped, Year in Books, deeper Series Insights, and historical shelf views.';
