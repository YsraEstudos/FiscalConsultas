export interface OfflineDatabaseMetadata {
  version: string;
  size_bytes: number;
  sha256: string;
  encrypted_sha256?: string | null;
  built_at?: string | null;
  updated_at?: string | null;
  format_version?: number;
  chunk_size?: number;
  pbkdf2_iterations?: number;
}

export function compareOfflineVersions(
  left: string | null | undefined,
  right: string | null | undefined
): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) return delta;
  }

  return 0;
}

export function formatOfflineDatabaseErrorMessage(
  error: unknown,
  fallbackMessage = "Unknown error"
): string {
  if (typeof error === "string") {
    return error.trim() || fallbackMessage;
  }

  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }

  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallbackMessage;
}

export function sanitizeOfflineMetadata(
  metadata: Partial<OfflineDatabaseMetadata> | null | undefined
): OfflineDatabaseMetadata | null {
  if (!metadata?.version) return null;

  return {
    version: String(metadata.version),
    size_bytes: Number(metadata.size_bytes || 0),
    sha256: String(metadata.sha256 || ""),
    encrypted_sha256: metadata.encrypted_sha256
      ? String(metadata.encrypted_sha256)
      : null,
    built_at: metadata.built_at ? String(metadata.built_at) : null,
    updated_at: metadata.updated_at ? String(metadata.updated_at) : null,
    format_version: Number(metadata.format_version || 1),
    chunk_size: Number(metadata.chunk_size || 65536),
    pbkdf2_iterations: Number(metadata.pbkdf2_iterations || 600000),
  };
}

