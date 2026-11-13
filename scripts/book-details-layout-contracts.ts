import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const css = read('src/components/bookDetailsResponsive.css');
const modal = read('src/components/BookDetailsModal.tsx');
const core = read('src/components/BookDetailsModalCore.tsx');
const capability = read('src/platform/bookDetailsLayoutCapability.ts');
const dialogFocus = read('src/components/bookDetailsDialogFocus.ts');

assert.match(capability, /max-width: 1023px/, 'Compact toolbar must include mobile web and tablets.');
assert.match(capability, /orientation: landscape.*max-height: 600px/,
  'Short landscape must use compact layout regardless of platform.');
assert.match(modal, /book-details-compact/, 'Compact modal requires an explicit scoped class.');
assert.match(core, /sm:max-h-\[88dvh\]/, 'Desktop height utility must not override compact landscape.');
assert.doesNotMatch(core, /sm:!max-h-\[88dvh\]/, 'Old important height is forbidden.');
const close = core.indexOf('className="book-details-close-button');
const header = core.indexOf('<header className="book-details-modal-header');
assert.ok(close > 0 && close < header, 'Close must live outside the scrolling header.');
assert.match(css, /grid-template-rows: minmax\(0, auto\) auto auto minmax\(64px, 1fr\) auto;/,
  'Compact modal must own its five rows.');
assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  'Four-action phone dock must use two columns.');
assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
  'Landscape dock must support four actions.');
assert.match(css, /min-height: 48px/, 'Compact touch targets must be at least 44px.');
assert.doesNotMatch(css, /span > span \{\s*display: none !important/,
  'Deadline and library due dates cannot be hidden.');
assert.match(css, /overflow-y: auto !important/, 'Only the editor should scroll vertically.');
assert.match(dialogFocus, /event\.key === 'Escape'/, 'Companion dialogs need Escape support.');
assert.match(dialogFocus, /event\.key === 'Tab'/, 'Companion dialogs need keyboard containment.');
for (const path of [
  'src/components/catalog/CatalogContributionLauncher.tsx',
  'src/components/edition/EditionLccnControl.tsx',
  'src/components/reading/FinishOnTimeControl.tsx',
  'src/components/library/LibraryLoanReminderControl.tsx',
]) {
  const source = read(path);
  assert.match(source, /createPortal\(/, path + ' must portal dialogs outside the footer.');
  assert.match(source, /useBookDetailsDialogFocus\(/, path + ' must restore dialog keyboard focus.');
}
const sessionActionsStart = core.indexOf('<div className="book-details-session-actions');
const sessionActionsEnd = core.indexOf('Start Reading Session</button>', sessionActionsStart);
assert.ok(sessionActionsStart !== -1 && sessionActionsEnd > sessionActionsStart,
  'Book Details must expose the three Sessions actions.');
const sessionActions = core.slice(sessionActionsStart, sessionActionsEnd + 'Start Reading Session</button>'.length);
for (const action of ['Add Past Session', 'Add Multiple', 'Start Reading Session']) {
  assert.ok(sessionActions.includes(action), 'Sessions action missing on compact view: ' + action);
}
const sessionCss = css.slice(css.indexOf('/* Sessions has three independent actions'));
assert.ok(sessionCss.includes('display: grid !important;') && sessionCss.includes('grid-template-columns: minmax(0, 1fr)'),
  'Portrait sessions controls should stack without clipping.');
assert.ok(sessionCss.includes('display: inline-flex !important;'),
  'All three compact session controls must remain visible.');
console.log('Book Details static layout contracts passed (viewport geometry still requires browser/device verification).');
