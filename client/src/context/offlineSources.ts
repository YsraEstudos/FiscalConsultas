export const FISCAL_OFFLINE_SOURCES = [
  { id: 'nesh', label: 'NESH' },
  { id: 'tipi', label: 'TIPI' },
  { id: 'nbs', label: 'NBS' },
  { id: 'unspsc', label: 'UNSPSC' },
] as const;

export type FiscalSourceId = (typeof FISCAL_OFFLINE_SOURCES)[number]['id'];

export interface FiscalBundleUrls {
  metadataUrl: string;
  encryptedUrl: string;
}

const FISCAL_SOURCE_IDS = new Set<string>(
  FISCAL_OFFLINE_SOURCES.map((source) => source.id),
);

export function isFiscalSourceId(value: unknown): value is FiscalSourceId {
  return typeof value === 'string' && FISCAL_SOURCE_IDS.has(value);
}

export function normalizeFiscalR2BaseUrl(value: string | undefined): string {
  return trimTrailingSlashes((value || '').trim());
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
}

export function buildFiscalBundleUrls(
  baseUrl: string,
  source: FiscalSourceId,
): FiscalBundleUrls {
  const normalizedBaseUrl = normalizeFiscalR2BaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error('baseUrl is required for fiscal bundle URLs');
  }

  return {
    metadataUrl: `${normalizedBaseUrl}/${source}/${source}.meta.json`,
    encryptedUrl: `${normalizedBaseUrl}/${source}/${source}.enc`,
  };
}

export function buildFiscalOfflineDatabaseUrls(baseUrl: string): FiscalBundleUrls {
  const normalizedBaseUrl = normalizeFiscalR2BaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error('baseUrl is required for fiscal database URLs');
  }

  return {
    metadataUrl: `${normalizedBaseUrl}/fiscal_offline.meta.json`,
    encryptedUrl: `${normalizedBaseUrl}/fiscal_offline.enc`,
  };
}
