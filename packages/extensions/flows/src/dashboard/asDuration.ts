/**
 * A duration a dashboard reader can take in at a glance.
 *
 * Sub-minute work still happened: flooring it to "0m" is the same lie as
 * printing "0.0s" for a step that failed instantly.
 */
export function asDuration(ms: number): string {
  // A record can be hand-edited, half-written, or written by an older version.
  // "NaNm" on a headline figure is worse than admitting the gap.
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return '0s';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;

  // Round once before splitting. Rounding the remainder independently emitted
  // impossible values such as "1h 60m" and even "60m" just before an hour.
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
