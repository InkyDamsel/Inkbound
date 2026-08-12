import { useEffect, useMemo, useState } from 'react';
import { useAccountSync } from '../context/AccountSyncContext';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type CloudDataUpdatedDetail,
  type LocalDataChangedDetail,
} from '../features/sync/cloudSyncEvents';

const PROFILE_STORAGE_KEY = 'inkbound_reader_profile';

interface StoredReaderIdentity {
  displayName?: string;
  avatarImage?: string;
  avatarImageData?: string;
}

const readStoredIdentity = (): StoredReaderIdentity => {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredReaderIdentity) : {};
  } catch {
    return {};
  }
};

export const useReaderProfileIdentity = () => {
  const { user } = useAccountSync();
  const [storedIdentity, setStoredIdentity] = useState<StoredReaderIdentity>(() =>
    user ? readStoredIdentity() : {},
  );

  useEffect(() => {
    const refresh = () => setStoredIdentity(user ? readStoredIdentity() : {});
    refresh();

    const handleCloudUpdate = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      if (detail?.keys?.includes(PROFILE_STORAGE_KEY)) refresh();
    };
    const handleLocalUpdate = (event: Event) => {
      const detail = (event as CustomEvent<LocalDataChangedDetail>).detail;
      if (detail?.keys?.includes(PROFILE_STORAGE_KEY)) refresh();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PROFILE_STORAGE_KEY) refresh();
    };

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudUpdate);
    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalUpdate);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudUpdate);
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, [user?.uid]);

  return useMemo(() => {
    if (!user) {
      return {
        displayName: 'Reader',
        avatarImage: undefined as string | undefined,
        initials: 'R',
      };
    }

    const displayName =
      storedIdentity.displayName?.trim() || user.displayName?.trim() || 'Reader';
    const avatarImage =
      storedIdentity.avatarImageData || storedIdentity.avatarImage || user.photoURL || undefined;
    const initials =
      displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || 'R';

    return { displayName, avatarImage, initials };
  }, [storedIdentity, user]);
};
