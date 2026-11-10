import type { DetectiveMergeCandidate } from './seriesDetectiveMerge';
import { canonicalDetectiveSeries } from './seriesDetectiveEvidence';

// Only explicit bibliographic branding qualifies for a cross-author roster.
// A topical subtitle such as "A Hades and Persephone Romance" is not branding.
export const hasExplicitDetectiveSeriesBrand = (
  candidate: DetectiveMergeCandidate,
  wantedSeriesName: string,
): boolean => {
  const wanted = canonicalDetectiveSeries(wantedSeriesName);
  if (!wanted) return false;
  return [candidate.work.title, candidate.edition.title, candidate.work.subtitle, candidate.edition.subtitle]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .some((value) => {
      const suffix = value.split(/[:(\[]/).slice(1).join(' ').replace(/[)\]]/g, ' ').trim();
      const branded = suffix.match(/^(.+?)\s+(?:series|saga)(?:\s+(?:book\s*)?#?\d+)?$/i);
      const numbered = suffix.match(/^(.+?)\s*(?:#|book\s*#?)\s*\d+$/i);
      const label = branded?.[1] ?? numbered?.[1];
      // Publishers also use a bare exact series subtitle, e.g.
      // "Conceal, Don't Feel: A Twisted Tale". Exact equality is required:
      // "A Hades and Persephone Romance" must never qualify.
      const exactSuffixBrand = Boolean(suffix && canonicalDetectiveSeries(suffix) === wanted);
      // Some catalog records store "Wellard Asylum Series" as the entire
      // subtitle rather than a colon-delimited suffix. Require the explicit
      // bibliographic "Series"/"Saga" designation, never a thematic phrase.
      const fullSubtitleBrand = /\b(?:series|saga)\s*$/i.test(value)
        && canonicalDetectiveSeries(value) === wanted;
      const bareSubtitleBrand = (value === candidate.work.subtitle || value === candidate.edition.subtitle)
        && canonicalDetectiveSeries(value) === wanted;
      return Boolean((label && canonicalDetectiveSeries(label) === wanted) || fullSubtitleBrand || exactSuffixBrand || bareSubtitleBrand);
    });
};

