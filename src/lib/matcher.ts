import type { BugReport } from './types';
import type { KnownBug } from './knownBugs';

/**
 * Автоматическое сопоставление баг-репортов с эталонным списком дефектов.
 *
 * Задача — не заменить валидатора, а снять с него рутину: сотня репортов на конкурс
 * означает сотни повторов одних и тех же находок. Матчер уверенно раскладывает
 * типовые формулировки по кодам, а всё сомнительное честно помечает как
 * «нужен взгляд» и оставляет человеку.
 */

export type MatchConfidence = 'high' | 'low' | 'none';

export interface MatchResult {
  reportId: string;
  /** Код эталонного дефекта или пустая строка, если не распознано. */
  code: string;
  confidence: MatchConfidence;
  /** Доля совпавших групп ключевых слов, 0..1. */
  score: number;
  /** Какие группы сработали — показываем валидатору, чтобы решение было проверяемым. */
  matched: string[];
  /** true, если тот же участник уже сдал репорт с этим кодом раньше. */
  duplicate: boolean;
}

/**
 * Приводим текст к виду, в котором сравнение устойчиво к регистру, «ё», пунктуации
 * и латинским подменам кириллицы (их в тренажёре хватает намеренно).
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Латинские двойники кириллических букв — иначе «Корзинa» не найдётся по «корзина».
    .replace(/a/g, 'а')
    .replace(/e/g, 'е')
    .replace(/o/g, 'о')
    .replace(/p/g, 'р')
    .replace(/c/g, 'с')
    .replace(/y/g, 'у')
    .replace(/x/g, 'х')
    // Минус сохраняем: без него ключи вроде «-3» вырождаются в «3» и цепляют любую цифру.
    .replace(/[^\p{L}\p{N}%+@.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ключевое слово считается найденным, если в тексте есть слово, начинающееся с него.
 * Это грубый стемминг, но для русского он снимает падежи и числа: «промокод» ловит
 * «промокоды», «промокодом», «промокода».
 */
function hasKeyword(haystack: string, needle: string): boolean {
  const key = normalize(needle);
  if (!key) return false;
  // Короткие ключи и символы вроде «%» ищем как подстроку — префиксное правило им не подходит.
  if (key.length <= 3 || /[^\p{L}]/u.test(key)) return haystack.includes(key);
  if (key.includes(' ')) return haystack.includes(key);
  return new RegExp(`(^| )${escapeRegExp(key)}`, 'u').test(haystack);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Весь текст репорта — по нему и ищем. */
export function reportText(report: BugReport): string {
  return normalize([report.title, report.steps, report.expected, report.actual].join(' '));
}

interface Scored {
  bug: KnownBug;
  score: number;
  matched: string[];
}

function scoreBug(text: string, bug: KnownBug): Scored {
  const matched: string[] = [];
  // Одно и то же слово не должно изображать два независимых признака: иначе репорт
  // из одного слова получал бы полное совпадение. Списки от таких повторов чистит
  // проверка в scripts/check-matcher.ts, здесь — страховка на случай правки руками.
  const used = new Set<string>();
  bug.keywords.forEach((group) => {
    const hit = group.find((word) => !used.has(word) && hasKeyword(text, word));
    if (hit) {
      matched.push(hit);
      used.add(hit);
    }
  });
  return { bug, score: bug.keywords.length ? matched.length / bug.keywords.length : 0, matched };
}

/**
 * Слова, которые встречаются ровно у одного дефекта. Таких в списке подавляющее
 * большинство, и одно такое слово — уже улика: «оформитьь» или «cvv» ни к какому
 * другому дефекту относиться не может.
 */
export function uniqueKeywords(knownBugs: KnownBug[]): Set<string> {
  const owners = new Map<string, number>();
  knownBugs.forEach((bug) => {
    new Set(bug.keywords.flat()).forEach((word) => owners.set(word, (owners.get(word) ?? 0) + 1));
  });
  return new Set([...owners.entries()].filter(([, count]) => count === 1).map(([word]) => word));
}

/** Короткие ключи вроде «12», «%» или «ьь» уликой сами по себе быть не могут. */
const SOLO_MIN_LENGTH = 4;

/**
 * Разбор одного репорта.
 *
 * Уверенно распознаём, когда сработали минимум две группы ключевых слов — то есть
 * текст задел и объект, и суть проблемы, — и ближайший конкурент явно слабее.
 * Одна сработавшая группа даёт не вердикт, а подсказку, и только если слово
 * принадлежит единственному дефекту: «корзина» есть в половине репортов и кодом
 * быть не может, а «оформитьь» — может.
 */
export function matchReport(
  report: BugReport,
  knownBugs: KnownBug[],
  unique = uniqueKeywords(knownBugs),
): Omit<MatchResult, 'duplicate'> {
  const text = reportText(report);
  const ranked = knownBugs
    .map((bug) => scoreBug(text, bug))
    .sort((a, b) => b.score - a.score || b.matched.length - a.matched.length);

  const none = { reportId: report.id, code: '', confidence: 'none' as const, score: 0, matched: [] };
  const best = ranked[0];
  if (!best || best.matched.length === 0) return none;

  const runnerUp = ranked[1];
  // Явно лучше конкурента: либо по доле сработавших групп, либо по их числу.
  // Прежняя проверка считала ничьёй любое равенство долей, из-за чего уверенные
  // совпадения уходили в ручной разбор.
  const clearLeader =
    !runnerUp || runnerUp.score < best.score || runnerUp.matched.length < best.matched.length;

  if (best.matched.length >= 2) {
    const confidence: MatchConfidence = clearLeader && best.score >= 0.6 ? 'high' : 'low';
    return {
      reportId: report.id,
      code: best.bug.code,
      confidence,
      score: best.score,
      matched: best.matched,
    };
  }

  const word = best.matched[0];
  const solid =
    unique.has(word) &&
    word.length >= SOLO_MIN_LENGTH &&
    (!runnerUp || runnerUp.matched.length === 0);
  if (!solid) return none;

  return {
    reportId: report.id,
    code: best.bug.code,
    // Одного признака мало для автоматического вердикта: показываем как «нужен взгляд»,
    // но с подставленным кодом — организатору остаётся подтвердить или поменять.
    confidence: 'low',
    score: best.score,
    matched: best.matched,
  };
}

/**
 * Разбор всей выгрузки. Дубликатом помечаем второй и последующий репорты одного
 * участника с тем же кодом — по времени создания, чтобы засчиталась первая находка.
 */
export function matchAll(reports: BugReport[], knownBugs: KnownBug[]): Map<string, MatchResult> {
  const byTime = [...reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const seen = new Set<string>();
  const result = new Map<string, MatchResult>();
  // Считаем один раз на всю выгрузку, а не на каждый репорт.
  const unique = uniqueKeywords(knownBugs);

  byTime.forEach((report) => {
    const base = matchReport(report, knownBugs, unique);
    const key = `${report.login}::${base.code}`;
    const duplicate = base.code !== '' && seen.has(key);
    if (base.code) seen.add(key);
    result.set(report.id, { ...base, duplicate });
  });

  return result;
}

export const CONFIDENCE_LABELS: Record<MatchConfidence, string> = {
  high: 'уверенно',
  low: 'нужен взгляд',
  none: 'не распознано',
};

export const CONFIDENCE_STYLES: Record<MatchConfidence, string> = {
  high: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  low: 'border-amber-200 bg-amber-100 text-amber-800',
  none: 'border-slate-200 bg-slate-100 text-slate-600',
};
