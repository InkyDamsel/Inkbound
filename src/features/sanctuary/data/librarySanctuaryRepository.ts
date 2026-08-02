import { LibrarySanctuary } from '../model/librarySanctuary';

export interface LibrarySanctuaryRepository {
  load(): Promise<LibrarySanctuary>;
  save(sanctuary: LibrarySanctuary): Promise<LibrarySanctuary>;
  reset(): Promise<LibrarySanctuary>;
}

export interface LibrarySanctuaryCloudStore {
  load(userId: string): Promise<Partial<LibrarySanctuary> | null>;
  save(userId: string, sanctuary: LibrarySanctuary): Promise<void>;
}
