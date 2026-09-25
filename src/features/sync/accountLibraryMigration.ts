export interface AccountLibraryMigrationHealth {
  localBookCount: number;
  cloudBookCount: number;
  migrationVerified: boolean;
}

export function needsAccountLibraryMigration({
  localBookCount,
  cloudBookCount,
  migrationVerified,
}: AccountLibraryMigrationHealth): boolean {
  if (localBookCount <= 0) return false;
  if (cloudBookCount === 0) return true;
  if (!migrationVerified) return true;
  return false;
}

export function canReportCloudLibraryHealthy(state: AccountLibraryMigrationHealth): boolean {
  return !needsAccountLibraryMigration(state);
}

export function missingLocalRecordIds<T extends { id: string }>(
  localItems: T[],
  cloudIds: ReadonlySet<string>,
): string[] {
  return localItems
    .map((item) => item.id)
    .filter((id) => Boolean(id) && !cloudIds.has(id));
}
