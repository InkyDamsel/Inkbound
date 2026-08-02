import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { LocalLibrarySanctuaryRepository } from '../data/localLibrarySanctuaryRepository';
import { LibrarySanctuary } from '../model/librarySanctuary';
import { LibrarySanctuaryController } from './librarySanctuaryController';

export interface UseLibrarySanctuaryResult {
  sanctuary: LibrarySanctuary;
  status: ReturnType<LibrarySanctuaryController['getSnapshot']>['status'];
  errorMessage: string | null;
  updateSanctuary: (changes: Partial<LibrarySanctuary>) => void;
  resetSanctuary: () => Promise<void>;
  clearError: () => void;
}

export function useLibrarySanctuary(): UseLibrarySanctuaryResult {
  const controller = useMemo(
    () => new LibrarySanctuaryController(new LocalLibrarySanctuaryRepository()),
    [],
  );

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    void controller.load();
  }, [controller]);

  return {
    sanctuary: state.sanctuary,
    status: state.status,
    errorMessage: state.errorMessage,
    updateSanctuary: (changes) => controller.update(() => changes),
    resetSanctuary: () => controller.reset(),
    clearError: () => controller.clearError(),
  };
}
