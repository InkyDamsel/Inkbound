import React, { createContext, ReactNode, useContext, useState } from 'react';
import { UserPlan } from '../types';

export const FREE_BOOK_LIMIT = 50;

const USER_PLAN_STORAGE_KEY = 'inkbound_user_plan';
const LEGACY_USER_PLAN_STORAGE_KEY = 'bookhaven_user_plan';

interface UserPlanContextType {
  userPlan: UserPlan;
  setUserPlan: (plan: UserPlan) => void;
  freeBookLimit: number;

  canAddBook: (currentBookCount: number) => boolean;
  remainingBookSlots: (currentBookCount: number) => number;
  canAddMultipleBooks: boolean;
  canUseBatchEdit: boolean;
  canRunUnlimitedImport: boolean;
  canViewDetailedReports: boolean;

  isUpgradeModalOpen: boolean;
  upgradeReason?: string;
  openUpgradeModal: (reason?: string) => void;
  closeUpgradeModal: () => void;
}

const UserPlanContext = createContext<UserPlanContextType | undefined>(undefined);

function readStoredUserPlan(): UserPlan {
  const storedPlan =
    localStorage.getItem(USER_PLAN_STORAGE_KEY) ??
    localStorage.getItem(LEGACY_USER_PLAN_STORAGE_KEY);

  return storedPlan === 'premium' ? 'premium' : 'free';
}

export const UserPlanProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userPlan, setUserPlanState] = useState<UserPlan>(readStoredUserPlan);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<string | undefined>(undefined);

  const setUserPlan = (plan: UserPlan) => {
    setUserPlanState(plan);
    localStorage.setItem(USER_PLAN_STORAGE_KEY, plan);
    localStorage.removeItem(LEGACY_USER_PLAN_STORAGE_KEY);
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

  const canAddBook = (currentBookCount: number) =>
    isPremium || currentBookCount < FREE_BOOK_LIMIT;

  const remainingBookSlots = (currentBookCount: number) =>
    isPremium ? Infinity : Math.max(0, FREE_BOOK_LIMIT - currentBookCount);

  return (
    <UserPlanContext.Provider
      value={{
        userPlan,
        setUserPlan,
        freeBookLimit: FREE_BOOK_LIMIT,
        canAddBook,
        remainingBookSlots,
        canAddMultipleBooks: isPremium,
        canUseBatchEdit: isPremium,
        canRunUnlimitedImport: isPremium,
        canViewDetailedReports: isPremium,
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
