import type { DetectiveMergeCandidate } from './seriesDetectiveMerge';
import { comparableDetectiveTitle, detectiveAuthorsCompatible, detectiveSeriesNamesCompatible } from './seriesDetectiveEvidence';

type Binding = { value: string };
type Row = Record<string, Binding | undefined>;
interface SparqlResult { results?: { bindings?: Row[] } }
export interface WikidataDiscovery {
  candidates: DetectiveMergeCandidate[];
  status: 'ok' | 'empty' | 'unavailable';
  error?: string;
}

/**
 * Wikidata P179 is a work-to-series assertion; P1545 is an ordinal qualifier.
 * The series QID is resolved by an exact owned-work anchor, never by blindly
 * selecting the first search hit for a series label.
 *
 * This is discovery evidence, not independent corroboration of another source.
 */
export async function discoverDetectiveWikidata(
  seed: { title: string; author: string },
  seriesName: string,
  signal?: AbortSignal,
): Promise<WikidataDiscovery> {
  const endpoint = 'https://query.wikidata.org/sparql';
  const query = `SELECT DISTINCT ?seed ?seedLabel ?seedAuthorLabel ?series ?seriesLabel WHERE {
    ?seed wdt:P179 ?series .
    ?seed rdfs:label ?seedLabel .
    FILTER(LANG(?seedLabel) = "en")
    ?seed wdt:P50 ?seedAuthor .
    ?seedAuthor rdfs:label ?seedAuthorLabel .
    FILTER(LANG(?seedAuthorLabel) = "en")
    ?series rdfs:label ?seriesLabel .
    FILTER(LANG(?seriesLabel) = "en")
    FILTER(LCASE(STR(?seedLabel)) = LCASE(${JSON.stringify(seed.title)}))
  } LIMIT 30`;
  const request = async (sparql: string): Promise<Row[]> => {
    const response = await fetch(endpoint + '?format=json&query=' + encodeURIComponent(sparql), {
      headers: { Accept: 'application/sparql-results+json' }, signal,
    });
    if (!response.ok) throw new Error('Wikidata HTTP ' + response.status);
    const data = await response.json() as SparqlResult;
    return data.results?.bindings ?? [];
  };
  try {
    const anchors = (await request(query)).filter(row =>
      row.seedAuthorLabel?.value && detectiveAuthorsCompatible(seed.author, row.seedAuthorLabel.value)
      && row.seriesLabel?.value && detectiveSeriesNamesCompatible(seriesName, row.seriesLabel.value)
      && /^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/.test(row.series?.value ?? ''));
    const seriesIds = [...new Set(anchors.map(row => row.series!.value.split('/').pop()!))];
    if (seriesIds.length !== 1) return { candidates: [], status: 'empty' };
    const seriesId = seriesIds[0];
    const membersQuery = `SELECT ?work ?workLabel ?authorLabel ?ordinal ?isbn13 ?isbn10 ?date WHERE {
      ?work p:P179 ?statement .
      ?statement ps:P179 wd:${seriesId} .
      OPTIONAL { ?statement pq:P1545 ?ordinal . }
      OPTIONAL { ?work wdt:P50 ?author . ?author rdfs:label ?authorLabel . FILTER(LANG(?authorLabel) = "en") }
      OPTIONAL { ?work wdt:P212 ?isbn13 . }
      OPTIONAL { ?work wdt:P957 ?isbn10 . }
      OPTIONAL { ?work wdt:P577 ?date . }
      ?work rdfs:label ?workLabel .
      FILTER(LANG(?workLabel) = "en")
    } LIMIT 120`;
    const rows = await request(membersQuery);
    const grouped = new Map<string, { title: string; authors: Set<string>; isbns: Set<string>; isbn10s: Set<string>; positions: Set<number>; dates: string[] }>();
    for (const row of rows) {
      const id = row.work?.value?.split('/').pop();
      const title = row.workLabel?.value;
      if (!id || !/^Q\d+$/.test(id) || !title) continue;
      let item = grouped.get(id);
      if (!item) {
        item = { title, authors: new Set(), isbns: new Set(), isbn10s: new Set(), positions: new Set(), dates: [] };
        grouped.set(id, item);
      }
      if (row.authorLabel?.value) item.authors.add(row.authorLabel.value);
      if (/^\d{13}$/.test(row.isbn13?.value?.replace(/[^\d]/g, '') ?? '')) item.isbns.add(row.isbn13!.value.replace(/[^\d]/g, ''));
      if (/^[\dX]{10}$/.test(row.isbn10?.value?.replace(/[^\dX]/gi, '').toUpperCase() ?? '')) item.isbn10s.add(row.isbn10!.value.replace(/[^\dX]/gi, '').toUpperCase());
      if (/^[1-9]\d*$/.test(row.ordinal?.value ?? '')) item.positions.add(Number(row.ordinal!.value));
      if (row.date?.value) item.dates.push(row.date.value);
    }
    const candidates: DetectiveMergeCandidate[] = [];
    for (const [id, item] of grouped) {
      if (!item.authors.size || !comparableDetectiveTitle(item.title)) continue;
      const positions = [...item.positions];
      // Conflicting native ordinals must not be flattened into a fabricated number.
      const position = positions.length === 1 ? positions[0] : null;
      const authors = [...item.authors];
      const year = item.dates.length ? Number(item.dates.sort()[0].slice(0, 4)) : 0;
      const edition = {
        source: 'wikidata' as const, externalEditionId: id, title: item.title, authors,
        genres: [], publicationYear: Number.isFinite(year) ? year : 0,
        format: 'ebook' as const, isbn13: [...item.isbns][0],
        isbn10: [...item.isbn10s][0], specialFeatures: [],
        seriesMemberships: [{ name: seriesName, provider: 'wikidata' as const, externalSeriesId: seriesId,
          ...(position !== null ? { position } : {}) }],
      };
      candidates.push({
        provider: 'wikidata', seriesProvider: 'wikidata',
        seriesStructured: true, seriesName, position,
        work: { key: 'wikidata:' + id, title: item.title, authors, genres: [], editions: [edition] },
        edition,
        nativeSeriesId: seriesId,
        evidenceOrigin: 'wikidata:P179',
      });
    }
    return { candidates, status: candidates.length ? 'ok' : 'empty' };
  } catch (error) {
    if (signal?.aborted) return { candidates: [], status: 'unavailable', error: 'cancelled' };
    return { candidates: [], status: 'unavailable', error: String(error) };
  }
}
