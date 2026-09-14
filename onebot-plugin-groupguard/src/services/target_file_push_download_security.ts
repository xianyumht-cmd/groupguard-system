import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent, type Dispatcher } from 'undici';

export type TargetFileResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type TargetFileLookupAll = (hostname: string) => Promise<Array<{ address: string; family?: number }>>;

export type PreparedTargetFileDownloadHop = {
  hostname: string;
  addresses: TargetFileResolvedAddress[];
  dispatcher: Dispatcher | null;
};

function normalizedHostname(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase().split('%')[0];
    if (value.startsWith('::ffff:')) {
      const mapped = value.slice('::ffff:'.length);
      if (net.isIPv4(mapped)) return isPrivateAddress(mapped);
      const parts = mapped.split(':');
      if (parts.length === 2 && parts.every(part => /^[0-9a-f]{1,4}$/.test(part))) {
        const high = Number.parseInt(parts[0], 16);
        const low = Number.parseInt(parts[1], 16);
        return isPrivateAddress(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
      }
    }
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd')
      || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')
      || value.startsWith('ff');
  }
  return true;
}

function normalizeResolvedAddress(value: { address: string; family?: number }): TargetFileResolvedAddress {
  const address = String(value?.address || '').trim();
  const detected = net.isIP(address);
  if (detected !== 4 && detected !== 6) throw new Error('target_file_push_invalid_dns_address');
  if (value.family !== undefined && Number(value.family) !== detected) {
    throw new Error('target_file_push_invalid_dns_address_family');
  }
  return { address, family: detected };
}

async function defaultLookupAll(hostname: string): Promise<Array<{ address: string; family?: number }>> {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

export function createPinnedTargetFileDispatcher(
  expectedHostname: string,
  addresses: TargetFileResolvedAddress[],
): Dispatcher {
  const expected = normalizedHostname(expectedHostname);
  const pinned = addresses.map(normalizeResolvedAddress);
  if (!expected || !pinned.length) throw new Error('target_file_push_pinned_dns_empty');

  return new Agent({
    autoSelectFamily: true,
    connect: {
      lookup(requestedHostname: string, lookupOptions: any, callback: any) {
        if (normalizedHostname(requestedHostname) !== expected) {
          const error = Object.assign(new Error('target_file_push_pinned_hostname_mismatch'), { code: 'ENOTFOUND' });
          callback(error);
          return;
        }

        const requestedFamily = typeof lookupOptions === 'number'
          ? Number(lookupOptions)
          : Number(lookupOptions?.family || 0);
        const candidates = requestedFamily === 4 || requestedFamily === 6
          ? pinned.filter(item => item.family === requestedFamily)
          : pinned;
        if (!candidates.length) {
          const error = Object.assign(new Error('target_file_push_pinned_address_family_unavailable'), { code: 'ENOTFOUND' });
          callback(error);
          return;
        }

        const wantsAll = typeof lookupOptions === 'object' && lookupOptions?.all === true;
        if (wantsAll) {
          callback(null, candidates.map(item => ({ address: item.address, family: item.family })));
          return;
        }
        callback(null, candidates[0].address, candidates[0].family);
      },
    },
  });
}

export async function prepareTargetFileDownloadHop(
  url: URL,
  lookupAll: TargetFileLookupAll = defaultLookupAll,
): Promise<PreparedTargetFileDownloadHop> {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('target_file_push_invalid_download_protocol');
  if (url.username || url.password) throw new Error('target_file_push_download_credentials_forbidden');

  const hostname = normalizedHostname(url.hostname);
  const allowPrivate = process.env.TARGET_FILE_PUSH_ALLOW_PRIVATE_DOWNLOADS === '1';
  if (!allowPrivate && (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local'))) {
    throw new Error('target_file_push_private_download_forbidden');
  }

  const literalFamily = net.isIP(hostname);
  const rawAddresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookupAll(hostname);
  const addresses = rawAddresses.map(normalizeResolvedAddress);
  if (!addresses.length) throw new Error('target_file_push_download_dns_empty');
  if (!allowPrivate && addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('target_file_push_private_download_forbidden');
  }

  return {
    hostname,
    addresses,
    dispatcher: literalFamily ? null : createPinnedTargetFileDispatcher(hostname, addresses),
  };
}
