/**
 * A failed/late protected catalog request is not a successful empty result.
 * Keep this helper free of Firebase/React dependencies so its behavior can be tested.
 */
export class CatalogRequestTimeout extends Error {
  constructor(provider: string) {
    super(provider + ' did not respond before the request deadline.');
    this.name = 'CatalogRequestTimeout';
  }
}

export function requireCatalogResponse<T>(provider: string, request: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new CatalogRequestTimeout(provider));
    }, ms);
    request.then(
      (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } },
      (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } },
    );
  });
}
