import { Dispatch, SetStateAction, useCallback, useEffect, useState } from 'react';
import {
  PhotoMemoryRecord,
  readPhotoMemoriesFromDevice,
  replacePhotoMemoriesOnDevice,
  subscribeToPhotoMemoryChanges,
} from './photoMemoryStore';
import {
  queuePhotoMemoryDelete,
  queuePhotoMemoryUpsert,
} from './photoMemorySyncQueue';

function recordsMatch(left: PhotoMemoryRecord, right: PhotoMemoryRecord) {
  return JSON.stringify(left) === JSON.stringify(right);
}

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
      const currentById = new Map(current.map((memory) => [memory.id, memory]));
      const nextById = new Map(next.map((memory) => [memory.id, memory]));

      void replacePhotoMemoriesOnDevice(next).then(() => {
        current.forEach((memory) => {
          if (!nextById.has(memory.id)) queuePhotoMemoryDelete(memory.id);
        });
        next.forEach((memory) => {
          const previous = currentById.get(memory.id);
          if (!previous || !recordsMatch(previous, memory)) queuePhotoMemoryUpsert(memory.id);
        });
      });

      return next;
    });
  }, []);

  return [memories, setMemories];
}
