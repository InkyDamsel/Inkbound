import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const PROTECTED_BOOK_DETAILS_COLLECTION = 'protectedBookDetails';
const WRITE_BATCH_SIZE = 350;

const WORK_KEYS = new Set([
  'title',
  'subtitle',
  'author',
  'summary',
  'publisherSummary',
  'personalSummary',
  'seriesName',
  'seriesOrder',
  'genres',
  'tropes',
  'contentWarnings',
  'publicationYear',
  'originalLanguage',
  'externalWorkId',
]);

const READER_KEYS = new Set([
  'review',
  'personalNotes',
  'favoriteQuotes',
  'privateTags',
  'collections',
  'whyIAddedThis',
]);

const EDITION_KEYS = new Set([
  'id',
  'format',
  'isbn',
  'isbn10',
  'isbn13',
  'asin',
  'pageCount',
  'audiobookDurationMins',
  'narrator',
  'publisher',
  'publicationDate',
  'coverGradient',
  'coverIcon',
  'language',
  'editionName',
  'binding',
  'specialFeatures',
  'externalSource',
  'externalEditionId',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function unwrapEnvelope(value: FirebaseFirestore.DocumentData): Record<string, unknown> {
  const record = asRecord(value);
  return 'data' in record ? asRecord(record.data) : record;
}

function pickAllowed(value: unknown, allowed: Set<string>): Record<string, unknown> {
  const record = asRecord(value);
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowed.has(key)));
}

async function commitTasks(tasks: Array<(batch: FirebaseFirestore.WriteBatch) => void>) {
  const db = getFirestore();
  for (let index = 0; index < tasks.length; index += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    tasks.slice(index, index + WRITE_BATCH_SIZE).forEach((task) => task(batch));
    await batch.commit();
  }
}

/**
 * Reapplies book details that changed after the selected recovery point.
 * The client ledger is independent from recovery snapshots, so an older restore
 * cannot roll back newer reader-entered summaries, notes, tags, series details,
 * or manual edition metadata. Cover URLs are intentionally excluded because the
 * dedicated manual-cover ledger owns that field.
 */
export async function reapplyProtectedBookDetails(targetUserId: string): Promise<number> {
  const db = getFirestore();
  const userRef = db.doc(`users/${targetUserId}`);
  const ledger = await userRef.collection(PROTECTED_BOOK_DETAILS_COLLECTION).get();
  if (ledger.empty) return 0;

  const tasks: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  const clientUpdatedAt = new Date().toISOString();
  let reapplied = 0;

  for (const ledgerDocument of ledger.docs) {
    const protectedDetails = ledgerDocument.data();
    const bookId = typeof protectedDetails.bookId === 'string' && protectedDetails.bookId
      ? protectedDetails.bookId
      : ledgerDocument.id;
    if (!bookId) continue;

    const bookRef = userRef.collection('books').doc(bookId);
    const bookSnapshot = await bookRef.get();
    if (!bookSnapshot.exists) continue;

    const book = unwrapEnvelope(bookSnapshot.data() ?? {});
    const work = {
      ...asRecord(book.work),
      ...pickAllowed(protectedDetails.work, WORK_KEYS),
    };

    const reader = pickAllowed(protectedDetails.reader, READER_KEYS);
    const editions = Array.isArray(book.editions)
      ? book.editions.filter((edition): edition is Record<string, unknown> => Boolean(edition) && typeof edition === 'object' && !Array.isArray(edition))
      : [];
    const protectedEdition = pickAllowed(protectedDetails.edition, EDITION_KEYS);
    const editionId = typeof protectedDetails.editionId === 'string' ? protectedDetails.editionId : '';

    let nextEditions = editions;
    if (editionId && Object.keys(protectedEdition).length > 0) {
      const targetIndex = editions.findIndex((edition) => edition.id === editionId);
      if (targetIndex >= 0) {
        nextEditions = editions.map((edition, index) => index === targetIndex
          ? { ...edition, ...protectedEdition, id: edition.id }
          : edition);
      }
    }

    const nextBook = {
      ...book,
      ...reader,
      work,
      editions: nextEditions,
    };

    tasks.push((batch) => batch.set(bookRef, {
      data: nextBook,
      updatedAt: FieldValue.serverTimestamp(),
      clientUpdatedAt,
    }));
    reapplied += 1;
  }

  await commitTasks(tasks);
  return reapplied;
}
