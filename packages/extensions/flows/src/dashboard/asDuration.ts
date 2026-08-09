/**
 * A duration a dashboard reader can take in at a glance.
 *
 * Sub-minute work still happened: flooring it to "0m" is the same lie as
 * printing "0.0s" for a step that failed instantly.
 */
export function asDuration(ms: number): string {
  if (ms <= 0) return '0s';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;

  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
