import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Timestamp, doc, onSnapshot } from 'firebase/firestore';
import { UserPlan } from '../types';
import { auth, db } from '../lib/firebase';

// The core library is intentionally unlimited for every reader. Premium is
// reserved for deeper reflection, analytics, creative exports, and power tools.
export const FREE_BOOK_LIMIT = Infinity;

export type AccessSource = 'free' | 'subscription' | 'vip' | 'courtesy';

interface EntitlementRecord {
  subscriptionStatus?: 'none' | 'active' | 'trialing' | 'past_due' | 'canceled';
  paidPremiumUntil?: Timestamp | string;
  vipEnabled?: boolean;
  courtesyPremiumUntil?: Timestamp | string;
}

interface UserPlanContextType {
  userPlan: UserPlan;
  accessSource: AccessSource;
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

function resolveAccess(entitlement: EntitlementRecord | undefined): { userPlan: UserPlan; accessSource: AccessSource } {
  if (!entitlement) return { userPlan: 'free', accessSource: 'free' };

  const now = Date.now();
  const paidIsActive =
    entitlement.subscriptionStatus === 'active' ||
    entitlement.subscriptionStatus === 'trialing' ||
    toMillis(entitlement.paidPremiumUntil) > now;
  const courtesyIsActive = toMillis(entitlement.courtesyPremiumUntil) > now;

  // VIP is intentionally permanent until an owner explicitly revokes it.
  if (entitlement.vipEnabled) return { userPlan: 'premium', accessSource: 'vip' };
  if (paidIsActive) return { userPlan: 'premium', accessSource: 'subscription' };
  if (courtesyIsActive) return { userPlan: 'premium', accessSource: 'courtesy' };
  return { userPlan: 'free', accessSource: 'free' };
}

function nextTimedAccessExpiry(entitlement: EntitlementRecord | undefined): number {
  if (!entitlement || entitlement.vipEnabled) return 0;
  if (entitlement.subscriptionStatus === 'active' || entitlement.subscriptionStatus === 'trialing') return 0;

  const now = Date.now();
  const futureExpiries = [
    toMillis(entitlement.paidPremiumUntil),
    toMillis(entitlement.courtesyPremiumUntil),
  ].filter((value) => value > now);

  return futureExpiries.length > 0 ? Math.min(...futureExpiries) : 0;
}

export const UserPlanProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userPlan, setUserPlanState] = useState<UserPlan>('free');
  const [accessSource, setAccessSource] = useState<AccessSource>('free');
  const [entitlementLoading, setEntitlementLoading] = useState(Boolean(auth && db));
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!auth || !db) {
      setUserPlanState('free');
      setAccessSource('free');
      setEntitlementLoading(false);
      return;
    }

    let unsubscribeEntitlement: (() => void) | undefined;
    let expiryTimer: number | undefined;

    const clearExpiryTimer = () => {
      if (expiryTimer !== undefined) {
        window.clearTimeout(expiryTimer);
        expiryTimer = undefined;
      }
    };

    const applyEntitlement = (entitlement: EntitlementRecord | undefined) => {
      clearExpiryTimer();

      const access = resolveAccess(entitlement);
      setUserPlanState(access.userPlan);
      setAccessSource(access.accessSource);
      setEntitlementLoading(false);

      const expiresAt = nextTimedAccessExpiry(entitlement);
      if (!expiresAt) return;

      // Re-evaluate locally when temporary Premium reaches its exact expiry.
      // Firestore does not emit a snapshot merely because time passed, so without
      // this timer a reader could remain Premium until refresh/navigation.
      const delay = Math.max(0, Math.min(expiresAt - Date.now() + 1000, 2_147_000_000));
      expiryTimer = window.setTimeout(() => applyEntitlement(entitlement), delay);
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeEntitlement?.();
      unsubscribeEntitlement = undefined;
      clearExpiryTimer();

      if (!user) {
        setUserPlanState('free');
        setAccessSource('free');
        setEntitlementLoading(false);
        return;
      }

      setEntitlementLoading(true);
      unsubscribeEntitlement = onSnapshot(
        doc(db, 'entitlements', user.uid),
        (snapshot) => {
          applyEntitlement(snapshot.data() as EntitlementRecord | undefined);
        },
        () => {
          clearExpiryTimer();
          setUserPlanState('free');
          setAccessSource('free');
          setEntitlementLoading(false);
        },
      );
    });

    return () => {
      clearExpiryTimer();
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
      accessSource,
      setUserPlan,
      freeBookLimit: FREE_BOOK_LIMIT,
      entitlementLoading,
      canAddBook: () => true,
      remainingBookSlots: () => Infinity,
      canAddMultipleBooks: true,
      canUseBatchEdit: isPremium,
      canRunUnlimitedImport: true,
      canViewDetailedReports: isPremium,
      isUpgradeModalOpen,
      upgradeReason,
      openUpgradeModal,
      closeUpgradeModal,
    };
  }, [accessSource, entitlementLoading, isUpgradeModalOpen, upgradeReason, userPlan]);

  return <UserPlanContext.Provider value={value}>{children}</UserPlanContext.Provider>;
};

export const useUserPlan = () => {
  const context = useContext(UserPlanContext);

  if (!context) {
    throw new Error('useUserPlan must be used within a UserPlanProvider');
  }

  return context;
};
