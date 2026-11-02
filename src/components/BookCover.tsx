import React, { useEffect, useState } from 'react';
import { BookWork, Edition } from '../types';
import { BookOpen, Headphones, Tablet, Bookmark, Star } from 'lucide-react';

interface BookCoverProps {
  work: BookWork;
  edition?: Edition;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  progressPercentage?: number;
  isFinished?: boolean;
  rating?: number;
  isSelected?: boolean;
  onSelectToggle?: () => void;
  showFormatBadge?: boolean;
  className?: string;
}

const normalizeCoverUrl = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`;
  return trimmed;
};

export const BookCover: React.FC<BookCoverProps> = ({
  work,
  edition,
  size = 'md',
  progressPercentage,
  isFinished = false,
  rating,
  isSelected,
  onSelectToggle,
  showFormatBadge = true,
  className = '',
}) => {
  const format = edition?.format || 'hardcover';
  const gradient = edition?.coverGradient || 'from-amber-950 via-stone-900 to-amber-900';
  const coverUrl = normalizeCoverUrl(edition?.coverUrl);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [coverUrl]);

  const sizeClasses = {
    sm: 'w-20 h-28 text-xs',
    md: 'w-28 h-40 text-xs',
    lg: 'w-28 h-40 text-xs sm:w-36 sm:h-52 sm:text-sm',
    xl: 'w-36 h-52 text-sm sm:w-48 sm:h-72 sm:text-base',
  };

  const FormatIcon = {
    ebook: Tablet,
    audiobook: Headphones,
    hardcover: BookOpen,
    paperback: BookOpen,
    other_physical: Bookmark,
  }[format];

  const showRealCover = Boolean(coverUrl) && !imageFailed;

  return (
    <div className={`relative group shrink-0 ${sizeClasses[size]} ${className}`}>
      {onSelectToggle && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelectToggle();
          }}
          className={`book-cover-select-toggle absolute left-0 top-0 z-30 flex h-11 w-11 items-center justify-center transition-opacity ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
          aria-label={isSelected ? 'Deselect book' : 'Select book for batch edit'}
        >
          <span
            aria-hidden="true"
            className={`flex h-6 w-6 items-center justify-center rounded-md border text-[11px] font-black shadow transition ${
              isSelected
                ? 'border-[#c5a059] bg-[#c5a059] text-white'
                : 'border-white/70 bg-black/65 text-transparent'
            }`}
          >
            ✓
          </span>
        </button>
      )}

      <div
        className={`book-cover-shadow book-cover-spine relative flex h-full w-full select-none flex-col justify-between overflow-hidden rounded-md border border-white/10 bg-gradient-to-br ${gradient} transition-transform duration-300 group-hover:-translate-y-1`}
      >
        {showRealCover ? (
          <img
            src={coverUrl}
            alt={`Cover of ${work.title} by ${work.author}`}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="relative z-10 flex h-full w-full flex-col justify-between p-2.5">
            <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-[#c5a059]">
              {showFormatBadge && (
                <span className="flex items-center gap-1 whitespace-nowrap rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-amber-200/90 backdrop-blur-xs">
                  <FormatIcon className="h-3 w-3" />
                  <span className="hidden sm:inline">{format}</span>
                </span>
              )}
            </div>

            <div className="my-auto px-1 py-1 text-center">
              <p className="line-clamp-3 font-serif font-bold leading-tight text-stone-100 drop-shadow-md">
                {work.title}
              </p>
              {size !== 'sm' && (
                <p className="mt-1 line-clamp-1 text-[11px] font-medium italic text-amber-100/80">
                  {work.author}
                </p>
              )}
            </div>

            <div className="mt-auto pt-1">
              {rating !== undefined && rating > 0 && size !== 'sm' && (
                <div className="mb-1 flex items-center justify-center gap-1 text-[#c5a059]">
                  <Star className="h-3 w-3 fill-current" />
                  <span className="text-[11px] font-bold text-white">{rating.toFixed(1)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {showRealCover && showFormatBadge && (
          <div className="absolute left-2 top-2 z-20 flex items-center gap-1 whitespace-nowrap rounded border border-white/15 bg-black/65 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200 backdrop-blur-sm">
            <FormatIcon className="h-3 w-3" />
            <span className="hidden sm:inline">{format}</span>
          </div>
        )}

        {showRealCover && rating !== undefined && rating > 0 && size !== 'sm' && (
          <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[#e2bd66] backdrop-blur-sm">
            <Star className="h-3 w-3 fill-current" />
            <span className="text-[11px] font-bold text-white">{rating.toFixed(1)}</span>
          </div>
        )}

        {progressPercentage !== undefined && progressPercentage > 0 && progressPercentage < 100 && (
          <div className="absolute inset-x-2 bottom-2 z-20 h-1.5 overflow-hidden rounded-full border border-white/20 bg-black/60">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-[#c5a059] transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        )}

        {!showRealCover && (
          <div className="pointer-events-none absolute inset-0 bg-radial from-transparent via-black/10 to-black/30" />
        )}
      </div>

      {isFinished && (
        <div className="absolute right-1 top-1 z-20 rounded bg-emerald-700 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
          Finished
        </div>
      )}
    </div>
  );
};