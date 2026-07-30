import React, { createContext, useContext, useState, ReactNode } from 'react';
import { UserPlan } from '../types';

export const FREE_BOOK_LIMIT = 50;

interface UserPlanContextType {
  userPlan: UserPlan;
  setUserPlan: (plan: UserPlan) => void;
  freeBookLimit: number;
  
  // Reusable permission checks
  canAddBook: (currentBookCount: number) => boolean;
  remainingBookSlots: (currentBookCount: number) => number;
  canAddMultipleBooks: boolean;
  canUseBatchEdit: boolean;
  canRunUnlimitedImport: boolean;
  canViewDetailedReports: boolean;
  
  // Upgrade Modal control
  isUpgradeModalOpen: boolean;
  upgradeReason?: string;
  openUpgradeModal: (reason?: string) => void;
  closeUpgradeModal: () => void;
}

const UserPlanContext = createContext<UserPlanContextType | undefined>(undefined);

export const UserPlanProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userPlan, setUserPlanState] = useState<UserPlan>(() => {
    const saved = localStorage.getItem('bookhaven_user_plan');
    return (saved as UserPlan) || 'free';
  });

  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<string | undefined>(undefined);

  const setUserPlan = (plan: UserPlan) => {
    setUserPlanState(plan);
    localStorage.setItem('bookhaven_user_plan', plan);
  };

  const openUpgradeModal = (reason?: string) => {
    setUpgradeReason(reason);
    setIsUpgradeModalOpen(true);
  };

  const closeUpgradeModal = () => {
    setIsUpgradeModalOpen(false);
    setUpgradeReason(undefined);
  };

  const isPremium = userPlan === 'premium';

  const canAddBook = (currentBookCount: number) => {
    if (isPremium) return true;
    return currentBookCount < FREE_BOOK_LIMIT;
  };

  const remainingBookSlots = (currentBookCount: number) => {
    if (isPremium) return Infinity;
    return Math.max(0, FREE_BOOK_LIMIT - currentBookCount);
  };

  const canAddMultipleBooks = isPremium;
  const canUseBatchEdit = isPremium;
  const canRunUnlimitedImport = isPremium;
  const canViewDetailedReports = isPremium;

  return (
    <UserPlanContext.Provider
      value={{
        userPlan,
        setUserPlan,
        freeBookLimit: FREE_BOOK_LIMIT,
        canAddBook,
        remainingBookSlots,
        canAddMultipleBooks,
        canUseBatchEdit,
        canRunUnlimitedImport,
        canViewDetailedReports,
        isUpgradeModalOpen,
        upgradeReason,
        openUpgradeModal,
        closeUpgradeModal,
      }}
    >
      {children}
    </UserPlanContext.Provider>
  );
};

export const useUserPlan = () => {
  const context = useContext(UserPlanContext);
  if (!context) {
    throw new Error('useUserPlan must be used within a UserPlanProvider');
  }
  return context;
};
