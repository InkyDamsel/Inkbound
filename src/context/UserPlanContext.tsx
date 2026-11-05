import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Timestamp, doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { PRODUCT_POLICY, isFeatureAvailableToFree } from '../config/productPolicy';
import { UserPlan } from '../types';
import { auth, functions, readDb } from '../lib/firebase';

// Backward-compatible export for existing consumers. The authoritative value now
// lives in productPolicy.ts with the rest of the Free/Premium rules.
export const FREE_BOOK_LIMIT = PRODUCT_POLICY.library.freeItemLimit;

export type AccessSource = 'free' | 'subscription' | 'vip' | 'courtesy' | 'trial';

interface EntitlementRecord {
  subscriptionStatus?: 'none' | 'active' | 'trialing' | 'past_due' | 'canceled';
  subscriptionProvider?: 'stripe' | 'google_play' | null;
  paidPremiumUntil?: Timestamp | string | null;
  vipEnabled?: boolean;
  courtesyPremiumUntil?: Timestamp | string | null;
  trialStartedAt?: Timestamp | string | null;
  trialPremiumUntil?: Timestamp | string | null;
  trialAvailable?: boolean;
}

interface UserPlanContextType {
  userPlan: UserPlan;
  accessSource: AccessSource;
  setUserPlan: (plan: UserPlan) => void;
  freeBookLimit: number;
  entitlementLoading: boolean;
  trialAvailable: boolean;
  trialEligibilityKnown: boolean;
  trialPremiumUntil: string | null;

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

function toIso(value: Timestamp | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function paidAccessIsActive(entitlement: EntitlementRecord): boolean {
  const paidUntil = toMillis(entitlement.paidPremiumUntil);
  const now = Date.now();
  if (entitlement.subscriptionStatus === 'active' || entitlement.subscriptionStatus === 'trialing') {
    // Legacy entitlements may not have an expiry. New Stripe/Play entitlements do,
    // and once that known expiry passes a stale status must never grant Premium forever.
    return paidUntil === 0 || paidUntil > now;
  }
  // A canceled subscription remains usable through the already-paid period.
  return entitlement.subscriptionStatus === 'canceled' && paidUntil > now;
}

function resolveAccess(entitlement: EntitlementRecord | undefined): { userPlan: UserPlan; accessSource: AccessSource } {
  if (!entitlement) return { userPlan: 'free', accessSource: 'free' };

  const now = Date.now();
  const courtesyIsActive = toMillis(entitlement.courtesyPremiumUntil) > now;
  const trialIsActive = toMillis(entitlement.trialPremiumUntil) > now;

  if (entitlement.vipEnabled) return { userPlan: 'premium', accessSource: 'vip' };
  if (paidAccessIsActive(entitlement)) return { userPlan: 'premium', accessSource: 'subscription' };
  if (courtesyIsActive) return { userPlan: 'premium', accessSource: 'courtesy' };
  if (trialIsActive) return { userPlan: 'premium', accessSource: 'trial' };
  return { userPlan: 'free', accessSource: 'free' };
}

function nextTimedAccessExpiry(entitlement: EntitlementRecord | undefined): number {
  if (!entitlement || entitlement.vipEnabled) return 0;

  const now = Date.now();
  const futureExpiries = [
    paidAccessIsActive(entitlement) ? toMillis(entitlement.paidPremiumUntil) : 0,
    toMillis(entitlement.courtesyPremiumUntil),
    toMillis(entitlement.trialPremiumUntil),
  ].filter((value) => value > now);

  return futureExpiries.length > 0 ? Math.min(...futureExpiries) : 0;
}

export const UserPlanProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userPlan, setUserPlanState] = useState<UserPlan>('free');
  const [accessSource, setAccessSource] = useState<AccessSource>('free');
  const [entitlementLoading, setEntitlementLoading] = useState(Boolean(auth));
  const [trialAvailable, setTrialAvailable] = useState(false);
  const [trialEligibilityKnown, setTrialEligibilityKnown] = useState(false);
  const [trialPremiumUntil, setTrialPremiumUntil] = useState<string | null>(null);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!auth) {
      setUserPlanState('free');
      setAccessSource('free');
      setTrialAvailable(false);
      setTrialEligibilityKnown(false);
      setTrialPremiumUntil(null);
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
      setTrialAvailable(Boolean(entitlement) && (entitlement?.trialAvailable ?? !entitlement?.trialStartedAt));
      setTrialEligibilityKnown(Boolean(entitlement));
      setTrialPremiumUntil(toIso(entitlement?.trialPremiumUntil));
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

      setUserPlanState('free');
      setAccessSource('free');
      setTrialAvailable(false);
      setTrialEligibilityKnown(false);
      setTrialPremiumUntil(null);
      setIsUpgradeModalOpen(false);
      setUpgradeReason(undefined);

      if (!user) {
        setEntitlementLoading(false);
        return;
      }

      setEntitlementLoading(true);
      void refreshFromServer();

      if (readDb) {
        unsubscribeEntitlement = onSnapshot(
          doc(readDb, 'entitlements', user.uid),
          (snapshot) => {
            applyEntitlement(snapshot.exists() ? snapshot.data() as EntitlementRecord : undefined);
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
    const allowed = (feature: Parameters<typeof isFeatureAvailableToFree>[0]) => isPremium || isFeatureAvailableToFree(feature);

    return {
      userPlan,
      accessSource,
      setUserPlan,
      freeBookLimit: PRODUCT_POLICY.library.freeItemLimit,
      entitlementLoading,
      trialAvailable,
      trialEligibilityKnown,
      trialPremiumUntil,
      canAddBook: (currentBookCount) => currentBookCount < PRODUCT_POLICY.library.freeItemLimit,
      remainingBookSlots: (currentBookCount) => Number.isFinite(PRODUCT_POLICY.library.freeItemLimit)
        ? Math.max(0, PRODUCT_POLICY.library.freeItemLimit - currentBookCount)
        : Infinity,
      canAddMultipleBooks: PRODUCT_POLICY.library.unlimitedImports,
      canUseBatchEdit: allowed('batchEdit'),
      canRunUnlimitedImport: PRODUCT_POLICY.library.unlimitedImports,
      canViewDetailedReports: allowed('detailedReports'),
      isUpgradeModalOpen,
      upgradeReason,
      openUpgradeModal,
      closeUpgradeModal,
    };
  }, [accessSource, entitlementLoading, isUpgradeModalOpen, trialAvailable, trialEligibilityKnown, trialPremiumUntil, upgradeReason, userPlan]);

  return <UserPlanContext.Provider value={value}>{children}</UserPlanContext.Provider>;
};

export const useUserPlan = () => {
  const context = useContext(UserPlanContext);

  if (!context) {
    throw new Error('useUserPlan must be used within a UserPlanProvider');
  }

  return context;
};
