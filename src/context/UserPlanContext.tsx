import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Timestamp, doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { UserPlan } from '../types';
import { auth, functions, readDb } from '../lib/firebase';

// The core library is intentionally unlimited for every reader. Premium is
// reserved for deeper reflection, analytics, creative exports, and power tools.
export const FREE_BOOK_LIMIT = Infinity;

export type AccessSource = 'free' | 'subscription' | 'vip' | 'courtesy';

interface EntitlementRecord {
  subscriptionStatus?: 'none' | 'active' | 'trialing' | 'past_due' | 'canceled';
  paidPremiumUntil?: Timestamp | string | null;
  vipEnabled?: boolean;
  courtesyPremiumUntil?: Timestamp | string | null;
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

function toMillis(value: Timestamp | string | null | undefined): number {
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
  const [entitlementLoading, setEntitlementLoading] = useState(Boolean(auth));
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!auth) {
      setUserPlanState('free');
      setAccessSource('free');
      setEntitlementLoading(false);
      return;
    }

    let unsubscribeEntitlement: (() => void) | undefined;
    let expiryTimer: number | undefined;
    let activeUid: string | null = null;

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
      const delay = Math.max(0, Math.min(expiresAt - Date.now() + 1000, 2_147_000_000));
      expiryTimer = window.setTimeout(() => applyEntitlement(entitlement), delay);
    };

    const refreshFromServer = async () => {
      if (!functions || !activeUid) return;
      try {
        const getMyEntitlement = httpsCallable<undefined, EntitlementRecord>(functions, 'getMyEntitlement');
        const response = await getMyEntitlement();
        applyEntitlement(response.data);
      } catch (error) {
        console.error('Inkbound could not refresh the authoritative account entitlement.', error);
      }
    };

    const handleEntitlementRefresh = () => {
      void refreshFromServer();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshFromServer();
    };

    window.addEventListener('inkbound:entitlement-refresh', handleEntitlementRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeEntitlement?.();
      unsubscribeEntitlement = undefined;
      clearExpiryTimer();
      activeUid = user?.uid ?? null;

      if (!user) {
        setUserPlanState('free');
        setAccessSource('free');
        setEntitlementLoading(false);
        return;
      }

      setEntitlementLoading(true);

      // First ask trusted server code for the effective entitlement. This is the
      // same backend data used by Administration, so Settings/sidebar cannot get
      // stuck on a stale or denied client-side Firestore read.
      void refreshFromServer();

      // Keep the direct listener as a fast live-update path when Firestore rules
      // permit it. The server lookup above remains the authoritative fallback.
      if (readDb) {
        unsubscribeEntitlement = onSnapshot(
          doc(readDb, 'entitlements', user.uid),
          (snapshot) => {
            if (snapshot.exists()) applyEntitlement(snapshot.data() as EntitlementRecord);
          },
          (error) => {
            console.warn('Inkbound entitlement live listener is unavailable; using secure server refresh instead.', error);
          },
        );
      }
    });

    return () => {
      clearExpiryTimer();
      unsubscribeEntitlement?.();
      unsubscribeAuth();
      window.removeEventListener('inkbound:entitlement-refresh', handleEntitlementRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const setUserPlan = (_plan: UserPlan) => {
    console.warn('Inkbound account access can only be changed by the secure entitlement service.');
  };

  const openUpgradeModal = (reason?: string) => {
    if (userPlan === 'premium') return;
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
