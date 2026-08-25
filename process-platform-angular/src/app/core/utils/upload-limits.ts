/**
 * Maximálna veľkosť nahrávaného súboru.
 * Rovnaká hodnota je aj na serveri v server/index.ts (MAX_UPLOAD_BYTES).
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const MAX_UPLOAD_LABEL = '100 MB';

/** Veľkosť v čitateľnej podobe (B / kB / MB). */
export function formatBytes(bytes?: number): string {
  const value = bytes ?? 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/** Dá sa súbor zobraziť v náhľade priamo v prehliadači? */
export function isPreviewable(mimeType?: string): boolean {
  return (mimeType ?? '').toLowerCase().startsWith('application/pdf');
}
