const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` as a local calendar day. UTC `Date` parsing would shift the day. */
export function parseIsoDate(value?: string | null): Date | undefined {
  const match = value?.slice(0, 10).match(ISO_DAY);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return date;
}

export function formatIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
