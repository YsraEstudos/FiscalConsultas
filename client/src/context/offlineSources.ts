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
  const normalizedValue = (value || '').trim().replace(/\/+$/, '');
  return normalizedValue || '/fiscal-bases';
}

export function buildFiscalBundleUrls(
  baseUrl: string,
  source: FiscalSourceId,
): FiscalBundleUrls {
  const normalizedBaseUrl = normalizeFiscalR2BaseUrl(baseUrl);

  return {
    metadataUrl: `${normalizedBaseUrl}/${source}/${source}.meta.json`,
    encryptedUrl: `${normalizedBaseUrl}/${source}/${source}.enc`,
  };
}
