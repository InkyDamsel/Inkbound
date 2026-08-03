import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Timestamp, doc, onSnapshot } from 'firebase/firestore';
import { UserPlan } from '../types';
import { auth, db } from '../lib/firebase';

export const FREE_BOOK_LIMIT = 50;

interface EntitlementRecord {
  subscriptionStatus?: 'none' | 'active' | 'trialing' | 'past_due' | 'canceled';
  paidPremiumUntil?: Timestamp | string;
  vipEnabled?: boolean;
  courtesyPremiumUntil?: Timestamp | string;
}

interface UserPlanContextType {
  userPlan: UserPlan;
  setUserPlan: (plan: UserPlan) => void;
  freeBookLimit: number;
  entitlementLoading: boolean;

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

function toMillis(value: Timestamp | string | undefined): number {
  if (!value) return 0;
  if (value instanceof Timestamp) return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function resolvePlan(entitlement: EntitlementRecord | undefined): UserPlan {
  if (!entitlement) return 'free';

  const now = Date.now();
  const paidIsActive =
    entitlement.subscriptionStatus === 'active' ||
    entitlement.subscriptionStatus === 'trialing' ||
    toMillis(entitlement.paidPremiumUntil) > now;
  const courtesyIsActive = toMillis(entitlement.courtesyPremiumUntil) > now;

  return entitlement.vipEnabled || paidIsActive || courtesyIsActive ? 'premium' : 'free';
}

export const UserPlanProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userPlan, setUserPlanState] = useState<UserPlan>('free');
  const [entitlementLoading, setEntitlementLoading] = useState(Boolean(auth && db));
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!auth || !db) {
      setUserPlanState('free');
      setEntitlementLoading(false);
      return;
    }

    let unsubscribeEntitlement: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeEntitlement?.();
      unsubscribeEntitlement = undefined;

      if (!user) {
        setUserPlanState('free');
        setEntitlementLoading(false);
        return;
      }

      setEntitlementLoading(true);
      unsubscribeEntitlement = onSnapshot(
        doc(db, 'entitlements', user.uid),
        (snapshot) => {
          setUserPlanState(resolvePlan(snapshot.data() as EntitlementRecord | undefined));
          setEntitlementLoading(false);
        },
        () => {
          setUserPlanState('free');
          setEntitlementLoading(false);
        },
      );
    });

    return () => {
      unsubscribeEntitlement?.();
      unsubscribeAuth();
    };
  }, []);

  // Kept only for compatibility with old prototype components. Client code is
  // deliberately unable to modify server-authoritative account access.
  const setUserPlan = (_plan: UserPlan) => {
    console.warn('Inkbound account access can only be changed by the secure entitlement service.');
  };

  const openUpgradeModal = (reason?: string) => {
    setUpgradeReason(reason);
    setIsUpgradeModalOpen(true);
  };

  const closeUpgradeModal = () => {
    setIsUpgradeModalOpen(false);
    setUpgradeReason(undefined);
  };

  const value = useMemo<UserPlanContextType>(() => {
    const isPremium = userPlan === 'premium';

    return {
      userPlan,
      setUserPlan,
      freeBookLimit: FREE_BOOK_LIMIT,
      entitlementLoading,
      canAddBook: (currentBookCount) => isPremium || currentBookCount < FREE_BOOK_LIMIT,
      remainingBookSlots: (currentBookCount) =>
        isPremium ? Infinity : Math.max(0, FREE_BOOK_LIMIT - currentBookCount),
      canAddMultipleBooks: isPremium,
      canUseBatchEdit: isPremium,
      canRunUnlimitedImport: isPremium,
      canViewDetailedReports: isPremium,
      isUpgradeModalOpen,
      upgradeReason,
      openUpgradeModal,
      closeUpgradeModal,
    };
  }, [entitlementLoading, isUpgradeModalOpen, upgradeReason, userPlan]);

  return <UserPlanContext.Provider value={value}>{children}</UserPlanContext.Provider>;
};

export const useUserPlan = () => {
  const context = useContext(UserPlanContext);

  if (!context) {
    throw new Error('useUserPlan must be used within a UserPlanProvider');
  }

  return context;
};
