# Inkbound Book Search Providers

Inkbound uses one shared search pipeline for Add Book, Cover Manager, and metadata enrichment.

## Google Books

Configured in the web app with:

```env
VITE_GOOGLE_BOOKS_API_KEY=your_google_books_key
```

## Open Library

Open Library uses its public search and cover APIs and does not require an API key.

## Hardcover

Hardcover is proxied through a Firebase Cloud Function so the API token is never shipped in the browser bundle.

Create a Hardcover API token in your Hardcover account settings, then store it as a Firebase Functions secret:

```bash
firebase functions:secrets:set HARDCOVER_API_TOKEN
```

Deploy functions after setting or rotating the token:

```bash
firebase deploy --only functions
```

Readers must be signed in for Hardcover enrichment. If the token is missing, expired, rate-limited, or the reader is signed out, Inkbound automatically continues with the other providers.

## Penguin Random House

Penguin Random House is used as a server-side Series Detective metadata provider. The API key must never be shipped in the browser bundle.

Store the key as a Firebase Functions secret:

```bash
firebase functions:secrets:set PENGUIN_RANDOM_HOUSE_API_KEY
```

Deploy the Detective function after setting or rotating the key:

```bash
firebase deploy --only functions:searchSeriesDetectivePenguinRandomHouse
```

Inkbound queries the PRH.US catalog, normalizes PRH Works/Titles into the shared Detective work/edition model, and treats PRH series name/number metadata as structured provider evidence. PRH results are merged with Google Books, Open Library, and Hardcover rather than persisted as a separate source of truth.

## Provider priority

Search results are normalized into Inkbound's shared work/edition model, merged by normalized title and primary author, deduplicated by ISBN/provider edition ID, then ranked using Inkbound's title/author/ISBN confidence scoring.

Goodreads remains an import source rather than a live metadata API. Amazon can be added later through its supported API once production credentials are available; do not scrape either service.
