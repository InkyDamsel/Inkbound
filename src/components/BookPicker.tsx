import React, { useId, useMemo, useState } from 'react';
import type { UserBookRecord } from '../types';

interface BookPickerProps {
  books: UserBookRecord[];
  value: string;
  onChange: (bookId: string) => void;
  label?: string;
  className?: string;
}

/** Shared, bounded book picker: never render thousands of native <option> elements. */
export const BookPicker: React.FC<BookPickerProps> = ({ books, value, onChange, label = 'Book', className = '' }) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = books.find((book) => book.id === value);
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const matches = term
      ? books.filter((book) => `${book.work.title} ${book.work.author}`.toLocaleLowerCase().includes(term))
      : books;
    return matches.slice(0, 60);
  }, [books, query]);

  return (
    <div className={`relative min-w-0 ${className}`} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        autoComplete="off"
        value={open ? query : (selected?.work.title ?? '')}
        placeholder="Search books by title or author"
        onFocus={() => { setQuery(''); setOpen(true); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); event.currentTarget.blur(); }
          if (event.key === 'Enter' && open && results.length > 0) {
            event.preventDefault();
            onChange(results[0].id);
            setOpen(false);
            event.currentTarget.blur();
          }
        }}
        className="min-h-12 w-full min-w-0 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-4 text-sm text-[var(--ink-ivory)] placeholder:text-[var(--ink-muted)]"
      />
      {open && (
        <div id={`${id}-list`} role="listbox" aria-label={label}
          className="absolute inset-x-0 top-full z-[180] mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-1 shadow-2xl">
          {results.length ? results.map((book) => (
            <button key={book.id} type="button" role="option" aria-selected={book.id === value}
              className="block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--ink-ivory)] hover:bg-white/10 focus:bg-white/10"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onChange(book.id); setOpen(false); setQuery(''); }}>
              <span className="block truncate font-semibold">{book.work.title}</span>
              <span className="block truncate text-xs text-[var(--ink-muted)]">{book.work.author}</span>
            </button>
          )) : <p className="p-3 text-sm text-[var(--ink-muted)]">No matching books.</p>}
          {results.length === 60 && <p className="px-3 py-2 text-xs text-[var(--ink-muted)]">Showing the first 60 matches. Type to narrow results.</p>}
        </div>
      )}
    </div>
  );
};
