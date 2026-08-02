import React from 'react';
import { BookOpen, Clock, Flame, Headphones } from 'lucide-react';
import { ResponsiveGrid } from '../../layout/responsive';

interface StatisticsSummaryGridProps {
  completedBooks: number;
  totalPagesRead: number;
  totalAudioMinutes: number;
  currentStreak: number;
}

export function StatisticsSummaryGrid({
  completedBooks,
  totalPagesRead,
  totalAudioMinutes,
  currentStreak,
}: StatisticsSummaryGridProps) {
  const summaries = [
    {
      label: 'Books Completed This Year',
      value: completedBooks.toLocaleString(),
      icon: BookOpen,
      iconClassName: 'text-[#c5a059]',
    },
    {
      label: 'Total Pages Read',
      value: totalPagesRead.toLocaleString(),
      icon: Clock,
      iconClassName: 'text-emerald-400',
    },
    {
      label: 'Audiobook Listening Time',
      value: `${(totalAudioMinutes / 60).toFixed(1)}h`,
      icon: Headphones,
      iconClassName: 'text-[#e5c158]',
    },
    {
      label: 'Current Reading Streak',
      value: `${currentStreak} Days`,
      icon: Flame,
      iconClassName: 'text-amber-400 fill-current',
    },
  ];

  return (
    <ResponsiveGrid minItemWidth={190} maxColumns={4} gap={16}>
      {summaries.map(({ label, value, icon: Icon, iconClassName }) => (
        <article
          key={label}
          className="space-y-1 rounded-2xl border border-[#c5a059]/20 bg-[#1c0f24] p-5 shadow-xl"
        >
          <Icon className={`h-5 w-5 ${iconClassName}`} />
          <p className="font-serif text-2xl font-bold text-[#f4efe6]">{value}</p>
          <p className="text-xs text-stone-400">{label}</p>
        </article>
      ))}
    </ResponsiveGrid>
  );
}
