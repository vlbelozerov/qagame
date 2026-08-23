/** Секунды в mm:ss (или h:mm:ss, если раунд длиннее часа). */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Русское склонение без самого числа: pluralWord(2, 'балл', 'балла', 'баллов') → 'балла'. */
export function pluralWord(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Русское склонение числительных: plural(2, 'балл', 'балла', 'баллов') → '2 балла'. */
export function plural(n: number, one: string, few: string, many: string): string {
  return `${n} ${pluralWord(n, one, few, many)}`;
}
