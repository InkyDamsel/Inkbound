import { Dispatch, SetStateAction, useCallback, useEffect, useState } from 'react';
import {
  PhotoMemoryRecord,
  readPhotoMemoriesFromDevice,
  replacePhotoMemoriesOnDevice,
  subscribeToPhotoMemoryChanges,
} from './photoMemoryStore';

export function usePhotoMemories(): [
  PhotoMemoryRecord[],
  Dispatch<SetStateAction<PhotoMemoryRecord[]>>,
] {
  const [memories, setMemoriesState] = useState<PhotoMemoryRecord[]>([]);

  const refresh = useCallback(() => {
    void readPhotoMemoriesFromDevice().then(setMemoriesState);
  }, []);

  useEffect(() => {
    refresh();
    return subscribeToPhotoMemoryChanges(refresh);
  }, [refresh]);

  const setMemories = useCallback<Dispatch<SetStateAction<PhotoMemoryRecord[]>>>((nextValue) => {
    setMemoriesState((current) => {
      const next = typeof nextValue === 'function'
        ? (nextValue as (value: PhotoMemoryRecord[]) => PhotoMemoryRecord[])(current)
        : nextValue;
      void replacePhotoMemoriesOnDevice(next);
      return next;
    });
  }, []);

  return [memories, setMemories];
}
