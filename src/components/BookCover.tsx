import React from 'react';
import { BookWork, Edition, Format } from '../types';
import { BookOpen, Headphones, Tablet, Bookmark, Star, Volume2 } from 'lucide-react';

interface BookCoverProps {
  work: BookWork;
  edition?: Edition;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  progressPercentage?: number;
  rating?: number;
  isSelected?: boolean;
  onSelectToggle?: () => void;
  showFormatBadge?: boolean;
  className?: string;
}

export const BookCover: React.FC<BookCoverProps> = ({
  work,
  edition,
  size = 'md',
  progressPercentage,
  rating,
  isSelected,
  onSelectToggle,
  showFormatBadge = true,
  className = '',
}) => {
  const format = edition?.format || 'hardcover';
  const gradient = edition?.coverGradient || 'from-amber-950 via-stone-900 to-amber-900';

  // Size dimensions
  const sizeClasses = {
    sm: 'w-20 h-28 text-xs',
    md: 'w-28 h-40 text-xs',
    lg: 'w-36 h-52 text-sm',
    xl: 'w-48 h-72 text-base',
  };

  const FormatIcon = {
    ebook: Tablet,
    audiobook: Headphones,
    hardcover: BookOpen,
    paperback: BookOpen,
    other_physical: Bookmark,
  }[format];

  return (
    <div className={`relative group shrink-0 ${sizeClasses[size]} ${className}`}>
      {/* Selection Checkbox */}
      {onSelectToggle && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectToggle();
          }}
          className={`absolute top-2 left-2 z-30 w-5 h-5 rounded border transition-all flex items-center justify-center ${
            isSelected
              ? 'bg-[#c5a059] border-[#c5a059] text-white shadow'
              : 'bg-black/40 border-white/60 text-transparent opacity-0 group-hover:opacity-100 hover:bg-black/60'
          }`}
          aria-label={isSelected ? 'Deselect book' : 'Select book for batch edit'}
        >
          ✓
        </button>
      )}

      {/* Main Cover Container */}
      <div
        className={`w-full h-full rounded-md overflow-hidden bg-gradient-to-br ${gradient} book-cover-shadow book-cover-spine transition-transform duration-300 group-hover:-translate-y-1 relative flex flex-col justify-between p-2.5 border border-white/10 select-none`}
      >
        {/* Top bar with Format & Series order */}
        <div className="flex items-center justify-between text-[#c5a059] font-medium text-[10px] tracking-wide uppercase z-10">
          {showFormatBadge && (
            <span className="flex items-center gap-1 bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-xs border border-white/10 text-amber-200/90">
              <FormatIcon className="w-3 h-3" />
              <span className="hidden sm:inline">{format}</span>
            </span>
          )}
          {work.seriesOrder && (
            <span className="ml-auto bg-amber-900/60 px-1.5 py-0.5 rounded text-amber-200 text-[9px] font-bold">
              #{work.seriesOrder}
            </span>
          )}
        </div>

        {/* Center Title & Author */}
        <div className="my-auto text-center px-1 z-10 py-1">
          <p className="font-serif font-bold text-stone-100 leading-tight drop-shadow-md line-clamp-3">
            {work.title}
          </p>
          {size !== 'sm' && (
            <p className="text-[11px] text-amber-100/80 font-medium mt-1 line-clamp-1 italic">
              {work.author}
            </p>
          )}
        </div>

        {/* Bottom Bar / Progress Overlay */}
        <div className="z-10 mt-auto pt-1">
          {rating !== undefined && rating > 0 && size !== 'sm' && (
            <div className="flex items-center justify-center gap-1 mb-1 text-[#c5a059]">
              <Star className="w-3 h-3 fill-current" />
              <span className="text-[11px] font-bold text-white">{rating.toFixed(1)}</span>
            </div>
          )}

          {progressPercentage !== undefined && progressPercentage > 0 && progressPercentage < 100 && (
            <div className="w-full bg-black/50 rounded-full h-1.5 overflow-hidden border border-white/20">
              <div
                className="bg-gradient-to-r from-amber-400 to-[#c5a059] h-full transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          )}
        </div>

        {/* Cover texture overlay */}
        <div className="absolute inset-0 bg-radial from-transparent via-black/10 to-black/30 pointer-events-none" />
      </div>

      {/* Ribbon Banner for Finished or Wishlist */}
      {progressPercentage === 100 && (
        <div className="absolute top-1 right-1 z-20 bg-emerald-700 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
          Finished
        </div>
      )}
    </div>
  );
};
