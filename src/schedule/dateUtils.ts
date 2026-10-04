export type Bucketing = 'week' | 'month';

export function bucketKey(date: Date, bucketing: Bucketing): string {
  if (bucketing === 'month') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  const monday = startOfWeek(date);
  return monday.toISOString().slice(0, 10);
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}

export function bucketLabel(key: string, bucketing: Bucketing): string {
  if (bucketing === 'month') {
    const [y, m] = key.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  const d = new Date(key);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Enumerates bucket keys between two dates (inclusive), in order. */
export function bucketRange(start: Date, end: Date, bucketing: Bucketing): string[] {
  const keys: string[] = [];
  const cursor = bucketing === 'month' ? new Date(start.getFullYear(), start.getMonth(), 1) : startOfWeek(start);
  const step = () => {
    if (bucketing === 'month') cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + 7);
  };
  let guard = 0;
  while (cursor <= end && guard++ < 2000) {
    keys.push(bucketKey(cursor, bucketing));
    step();
  }
  return keys;
}
