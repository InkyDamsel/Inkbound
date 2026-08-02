import React from 'react';
import { ResponsiveGrid } from '../../layout/responsive';

interface MonthlyCompletion {
  month: string;
  count: number;
}

interface StatisticsGoalOverviewProps {
  completedBooks: number;
  annualGoal: number;
  annualGoalPercent: number;
  monthlyData: MonthlyCompletion[];
}

export const StatisticsGoalOverview: React.FC<StatisticsGoalOverviewProps> = ({
  completedBooks,
  annualGoal,
  annualGoalPercent,
  monthlyData,
}) => {
  const maxMonthCount = Math.max(1, ...monthlyData.map((item) => item.count));

  return (
    <ResponsiveGrid minItemWidth={280} maxColumns={3} gap={24}>
      <div className="flex flex-col justify-between space-y-3 rounded-2xl border border-[#c5a059]/20 bg-[#1c0f24] p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase text-stone-400">2026 Goal Progress</span>
          <span className="text-xs font-bold text-[#e5c158]">
            {completedBooks} / {annualGoal} books
          </span>
        </div>
        <div>
          <p className="font-serif text-3xl font-bold text-[#f4efe6]">{annualGoalPercent}%</p>
          <p className="mt-1 text-xs text-stone-400">On pace to meet annual reading target.</p>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full border border-[#3d2448] bg-[#120817]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#c5a059] to-[#d4af37] transition-all duration-500"
            style={{ width: `${annualGoalPercent}%` }}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-[#c5a059]/20 bg-[#1c0f24] p-5 shadow-xl md:col-span-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase text-stone-400">Monthly Finished Books Count</span>
          <span className="text-xs font-bold text-[#e5c158]">Simple Monthly Tracker</span>
        </div>

        <div className="flex h-28 items-end justify-between gap-2 border-b border-[#3d2448] pt-2">
          {monthlyData.map((item) => {
            const heightPercent = Math.round((item.count / maxMonthCount) * 100);

            return (
              <div key={item.month} className="group flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] font-bold text-[#e5c158]">{item.count}</span>
                <div
                  className="w-full rounded-t bg-gradient-to-t from-[#c5a059] to-[#e5c158] transition-all duration-500"
                  style={{ height: `${heightPercent}%` }}
                />
                <span className="text-[10px] font-semibold text-stone-400">{item.month}</span>
              </div>
            );
          })}
        </div>
      </div>
    </ResponsiveGrid>
  );
};
