export function isValidDateString(dateStr?: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const trimmed = dateStr.trim();
  // Require full date YYYY-MM-DD or ISO 8601 timestamp (reject partial dates like "2026" or "2026-05")
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(trimmed);
  if (!match) return false;

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);

  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;

  // Validate exact days in month (handling leap years and 30-day months)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return false;

  const parsed = new Date(trimmed);
  return !isNaN(parsed.getTime());
}

export function parseDate(dateStr?: string): Date | null {
  if (!isValidDateString(dateStr)) return null;
  const parsed = new Date(dateStr!.trim());
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function isFutureDate(
  eventDate: Date | string,
  referenceDate: Date | string
): boolean {
  const dEvent = typeof eventDate === 'string' ? parseDate(eventDate) : eventDate;
  const dRef = typeof referenceDate === 'string' ? parseDate(referenceDate) : referenceDate;
  if (!dEvent || !dRef) return false;
  return dEvent.getTime() > dRef.getTime();
}

export function daysBetween(start: Date | string, end: Date | string): number {
  const dStart = typeof start === 'string' ? parseDate(start) : start;
  const dEnd = typeof end === 'string' ? parseDate(end) : end;
  if (!dStart || !dEnd) return 0;
  const diffTime = dEnd.getTime() - dStart.getTime();
  return diffTime / (1000 * 60 * 60 * 24);
}

export function weeksBetween(start: Date | string, end: Date | string): number {
  return daysBetween(start, end) / 7;
}

export function isWithinLookback(
  eventDate: Date | string,
  referenceDate: Date | string,
  lookbackDays: number
): boolean {
  const dEvent = typeof eventDate === 'string' ? parseDate(eventDate) : eventDate;
  const dRef = typeof referenceDate === 'string' ? parseDate(referenceDate) : referenceDate;
  if (!dEvent || !dRef || lookbackDays < 0) return false;
  
  const diffDays = (dRef.getTime() - dEvent.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= lookbackDays;
}
