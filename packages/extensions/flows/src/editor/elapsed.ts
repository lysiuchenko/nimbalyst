/**
 * The compact clock a running node badge wears: whole seconds while under a
 * minute (`12s`), then minutes and zero-padded seconds (`1m 03s`) so the width
 * stays steady as it ticks.
 */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}
