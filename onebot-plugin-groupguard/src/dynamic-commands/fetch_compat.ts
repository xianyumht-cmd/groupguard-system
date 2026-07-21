type CompatibleFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let cachedFetch: CompatibleFetch | null = null;
let resolvingFetchPromise: Promise<CompatibleFetch> | null = null;

async function resolveCompatibleFetch(): Promise<CompatibleFetch> {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as CompatibleFetch;
  }

  const specifiers = ['undici', 'node-fetch'];
  for (const specifier of specifiers) {
    try {
      const imported = await import(specifier);
      const resolvedFetch = imported.fetch || imported.default;
      if (typeof resolvedFetch === 'function') {
        return resolvedFetch as CompatibleFetch;
      }
    } catch {
    }
  }

  throw new Error('fetch_unavailable');
}

export async function getCompatibleFetch(): Promise<CompatibleFetch> {
  if (cachedFetch) return cachedFetch;
  if (!resolvingFetchPromise) {
    resolvingFetchPromise = resolveCompatibleFetch().then((resolved) => {
      cachedFetch = resolved;
      resolvingFetchPromise = null;
      return resolved;
    }).catch((error) => {
      resolvingFetchPromise = null;
      throw error;
    });
  }
  return resolvingFetchPromise;
}
