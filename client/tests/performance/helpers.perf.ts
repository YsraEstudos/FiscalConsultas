export interface PerfSummary {
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
}

const clampPercentileIndex = (length: number, percentile: number): number => {
  if (length <= 1) return 0;
  const index = Math.ceil((percentile / 100) * length) - 1;
  return Math.min(length - 1, Math.max(0, index));
};

export const summarizeDurations = (durations: number[]): PerfSummary => {
  if (durations.length === 0) {
    throw new Error('durations must not be empty');
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const total = sorted.reduce((acc, value) => acc + value, 0);

  const pick = (percentile: number): number =>
    sorted[clampPercentileIndex(sorted.length, percentile)];

  return {
    samples: sorted.length,
    p50: pick(50),
    p95: pick(95),
    p99: pick(99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: total / sorted.length,
  };
};
