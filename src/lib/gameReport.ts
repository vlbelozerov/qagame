import type { KnownBug } from './knownBugs';
import type { MatchResult } from './matcher';
import { plural } from './format';
import { mentionsHoneypot } from './honeypot';
import type {
  BugReport,
  Nomination,
  Participant,
  PublishedResults,
  GameState,
  StandingRow,
} from './types';

/**
 * Итоги игры для объявления результатов.
 *
 * Считается только по принятым дефектам: отклонённые и дубликаты не должны влиять
 * ни на номинации, ни на статистику находок. Номинация не выводится вовсе, если
 * данных для неё не набралось, — пустая карточка «победитель не определён» на
 * награждении выглядит нелепо.
 */

export type { Nomination } from './types';

export interface GameReport {
  round: number;
  participants: number;
  accepted: number;
  totalReports: number;
  /** Сколько эталонных дефектов найдено хотя бы кем-то. */
  foundBugs: number;
  knownBugs: number;
  nominations: Nomination[];
  /** Дефекты, которые не нашёл никто, — их зачитывают в конце. */
  missed: KnownBug[];
  /** Турнирная таблица: её же видит участник в личных итогах. */
  standings: StandingRow[];
}

function formatTime(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function buildGameReport(
  round: number,
  reports: BugReport[],
  matches: Map<string, MatchResult>,
  knownBugs: KnownBug[],
  participants: Participant[] = [],
): GameReport {
  const inRound = reports.filter((r) => (r.round ?? 0) === round);
  const accepted = inRound.filter((r) => r.status === 'accepted');
  const logins = [...new Set(inRound.map((r) => r.login))];
  // Проставленный организатором код важнее догадки матчера: покрытие и номинации
  // должны отражать разбор, а не то, что автомат сумел распознать по словам.
  const codeOf = (r: BugReport) => r.bugCode || matches.get(r.id)?.code || '';
  const bugByCode = new Map(knownBugs.map((b) => [b.code, b]));

  // Кто какой дефект нашёл: по принятым, каждый участник считается один раз.
  const findersByCode = new Map<string, Set<string>>();
  accepted.forEach((r) => {
    const code = codeOf(r);
    if (!code) return;
    const set = findersByCode.get(code) ?? new Set<string>();
    set.add(r.login);
    findersByCode.set(code, set);
  });

  const nominations: Nomination[] = [];
  const add = (n: Nomination | null) => {
    if (n) nominations.push(n);
  };

  // --- Самый быстрый дефект ---
  const fastest = [...accepted].sort((a, b) => a.elapsedSec - b.elapsedSec)[0];
  add(
    fastest
      ? {
          key: 'fastest',
          emoji: '⚡',
          title: 'Самая быстрая находка',
          winner: fastest.login,
          detail: `«${fastest.title}» — на ${formatTime(fastest.elapsedSec)} от старта игры`,
          winnerLogins: [fastest.login],
        }
      : null,
  );

  // --- Самый популярный дефект ---
  const ranked = [...findersByCode.entries()].sort((a, b) => b[1].size - a[1].size);
  const popular = ranked[0];
  add(
    popular
      ? {
          key: 'popular',
          emoji: '👀',
          title: 'Самый заметный дефект',
          winner: bugByCode.get(popular[0])?.title ?? popular[0],
          detail: `его нашли ${plural(popular[1].size, 'участник', 'участника', 'участников')} из ${logins.length}`,
          // Номинация досталась дефекту, а не человеку: личных победителей здесь нет.
          winnerLogins: [],
        }
      : null,
  );

  // --- Самый редкий из найденных ---
  const rarest = ranked[ranked.length - 1];
  add(
    rarest && ranked.length > 1 && rarest[1].size === 1
      ? {
          key: 'rarest',
          emoji: '💎',
          title: 'Самая редкая находка',
          winner: bugByCode.get(rarest[0])?.title ?? rarest[0],
          detail: `единственный, кто заметил, — ${[...rarest[1]][0]}`,
          winnerLogins: [...rarest[1]],
        }
      : null,
  );

  // --- Больше всего принятых находок ---
  const byLogin = (fn: (r: BugReport) => boolean) => {
    const counts = new Map<string, number>();
    inRound.filter(fn).forEach((r) => counts.set(r.login, (counts.get(r.login) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };

  const mostAccepted = byLogin((r) => r.status === 'accepted')[0];
  add(
    mostAccepted
      ? {
          key: 'volume',
          emoji: '🎯',
          title: 'Пулемётчик',
          winner: mostAccepted[0],
          detail: `${plural(mostAccepted[1], 'подтверждённая находка', 'подтверждённые находки', 'подтверждённых находок')} за игру`,
          winnerLogins: [mostAccepted[0]],
        }
      : null,
  );

  // --- Точность: доля принятого от заведённого ---
  const accuracy = logins
    .map((login) => {
      const own = inRound.filter((r) => r.login === login);
      const good = own.filter((r) => r.status === 'accepted').length;
      return { login, total: own.length, good, ratio: own.length ? good / own.length : 0 };
    })
    // Меньше трёх заявок — не показатель меткости, а везение.
    .filter((x) => x.total >= 3)
    .sort((a, b) => b.ratio - a.ratio || b.good - a.good);
  add(
    accuracy[0] && accuracy[0].ratio > 0
      ? {
          key: 'sniper',
          emoji: '🔍',
          title: 'Снайпер',
          winner: accuracy[0].login,
          detail: `${Math.round(accuracy[0].ratio * 100)}% попаданий: ${accuracy[0].good} из ${accuracy[0].total} заявок засчитано`,
          winnerLogins: [accuracy[0].login],
        }
      : null,
  );

  // --- Уникальные находки: то, что не увидел больше никто ---
  const uniqueByLogin = new Map<string, number>();
  findersByCode.forEach((finders) => {
    if (finders.size !== 1) return;
    const login = [...finders][0];
    uniqueByLogin.set(login, (uniqueByLogin.get(login) ?? 0) + 1);
  });
  const explorer = [...uniqueByLogin.entries()].sort((a, b) => b[1] - a[1])[0];
  add(
    explorer && explorer[1] > 1
      ? {
          key: 'explorer',
          emoji: '🧭',
          title: 'Первопроходец',
          winner: explorer[0],
          detail: `нашёл ${plural(explorer[1], 'дефект', 'дефекта', 'дефектов')}, которые не заметил больше никто`,
          winnerLogins: [explorer[0]],
        }
      : null,
  );

  // --- Самая дорогая единичная находка ---
  const jackpot = [...accepted].sort((a, b) => b.score - a.score)[0];
  add(
    jackpot && jackpot.score > 0
      ? {
          key: 'jackpot',
          emoji: '💰',
          title: 'Джекпот',
          winner: jackpot.login,
          detail: `«${jackpot.title}» принесла ${plural(jackpot.score, 'балл', 'балла', 'баллов')} за один раз`,
          winnerLogins: [jackpot.login],
        }
      : null,
  );

  // --- Последняя находка игры ---
  const lastOne = [...accepted].sort((a, b) => b.elapsedSec - a.elapsedSec)[0];
  add(
    lastOne && fastest && lastOne.id !== fastest.id
      ? {
          key: 'marathon',
          emoji: '🏁',
          title: 'На последнем дыхании',
          winner: lastOne.login,
          detail: `сдал «${lastOne.title}» на ${formatTime(lastOne.elapsedSec)} — позже всех`,
          winnerLogins: [lastOne.login],
        }
      : null,
  );

  // --- Самый многословный заголовок ---
  const wordy = [...accepted].sort((a, b) => b.title.length - a.title.length)[0];
  add(
    wordy && wordy.title.length > 60
      ? {
          key: 'wordy',
          emoji: '📜',
          title: 'Летописец',
          winner: wordy.login,
          detail: `заголовок на ${plural(wordy.title.length, 'символ', 'символа', 'символов')} — остальные обошлись короче`,
          winnerLogins: [wordy.login],
        }
      : null,
  );

  // --- Самый лаконичный заголовок ---
  const terse = [...accepted].sort((a, b) => a.title.length - b.title.length)[0];
  add(
    terse && wordy && terse.id !== wordy.id
      ? {
          key: 'terse',
          emoji: '✂️',
          title: 'Телеграфный стиль',
          winner: terse.login,
          detail: `уложился в ${plural(terse.title.length, 'символ', 'символа', 'символов')}: «${terse.title}»`,
          winnerLogins: [terse.login],
        }
      : null,
  );

  // --- Дубликаты ---
  const dupes = byLogin((r) => r.status === 'duplicate')[0];
  add(
    dupes && dupes[1] > 1
      ? {
          key: 'echo',
          emoji: '🔁',
          title: 'Эхо',
          winner: dupes[0],
          detail: `${plural(dupes[1], 'раз', 'раза', 'раз')} завёл то, что уже находил сам`,
          winnerLogins: [dupes[0]],
        }
      : null,
  );

  // --- Любопытные: снимали оверлей до старта или попались на промокод-приманку ---
  const caught = new Set(
    participants.filter((p) => p.peeked).map((p) => p.login),
  );
  inRound.forEach((r) => {
    if (mentionsHoneypot(`${r.title} ${r.steps} ${r.expected} ${r.actual}`)) caught.add(r.login);
  });
  add(
    caught.size > 0
      ? {
          key: 'peeked',
          emoji: '🕵️',
          title: 'Любопытный',
          winner: [...caught].join(', '),
          detail:
            caught.size === 1
              ? 'заглянул в витрину до старта игры — оверлей это заметил'
              : `заглянули в витрину до старта игры: ${caught.size}`,
          winnerLogins: [...caught],
        }
      : null,
  );

  const missed = knownBugs.filter((b) => !findersByCode.has(b.code));

  // --- Турнирная таблица ---
  // В неё попадают все, кто заводил дефекты, и все зарегистрированные в игре
  // участники: вошедший и ничего не нашедший тоже должен увидеть себя в списке.
  const standingLogins = [
    ...new Set([...logins, ...participants.filter((p) => p.round === round).map((p) => p.login)]),
  ];
  const countBy = (login: string, status: BugReport['status']) =>
    inRound.filter((r) => r.login === login && r.status === status).length;

  const standings: StandingRow[] = standingLogins
    .map((login) => {
      const own = inRound.filter((r) => r.login === login);
      const good = own.filter((r) => r.status === 'accepted');
      return {
        place: 0,
        login,
        score: good.reduce((sum, r) => sum + (r.score || 0), 0),
        accepted: good.length,
        rejected: countBy(login, 'rejected'),
        duplicate: countBy(login, 'duplicate'),
        total: own.length,
        unique: uniqueByLogin.get(login) ?? 0,
        firstAcceptedSec: good.length
          ? Math.min(...good.map((r) => r.elapsedSec))
          : -1,
      };
    })
    // При равных баллах выше тот, кто набрал их меньшим числом заявок, а затем — быстрее.
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.accepted - a.accepted ||
        a.total - b.total ||
        a.login.localeCompare(b.login),
    );

  // Одинаковый результат — одинаковое место: делить призёров случайным порядком нечестно.
  standings.forEach((row, i) => {
    const previous = standings[i - 1];
    row.place =
      previous && previous.score === row.score && previous.accepted === row.accepted
        ? previous.place
        : i + 1;
  });

  return {
    round,
    participants: logins.length,
    accepted: accepted.length,
    totalReports: inRound.length,
    foundBugs: findersByCode.size,
    knownBugs: knownBugs.length,
    nominations,
    missed,
    standings,
  };
}

/**
 * Версия итогов для участников.
 *
 * Из отчёта убирается всё, что участникам знать не положено: подсказки эталонного
 * списка и номинация «Любопытный» — публично называть подглядывавших организатор
 * не обязан, в админке она остаётся.
 */
export function toPublishedResults(report: GameReport, round: GameState): PublishedResults {
  return {
    round: report.round,
    title: round.number === report.round ? round.title : '',
    publishedAt: new Date().toISOString(),
    participants: report.participants,
    accepted: report.accepted,
    totalReports: report.totalReports,
    foundBugs: report.foundBugs,
    knownBugs: report.knownBugs,
    standings: report.standings,
    nominations: report.nominations.filter((n) => n.key !== 'peeked'),
    missed: report.missed.map((b) => ({ code: b.code, title: b.title })),
  };
}

/** Текст для рассылки в чат: номинации без вёрстки. */
export function reportToText(report: GameReport): string {
  const lines = [
    'Итоги игры',
    `Участников: ${report.participants} · подтверждённых находок: ${report.accepted} из ${report.totalReports} заявок`,
    `Найдено дефектов: ${report.foundBugs} из ${report.knownBugs}`,
    '',
    ...report.nominations.map((n) => `${n.emoji} ${n.title}: ${n.winner} — ${n.detail}`),
  ];
  if (report.missed.length > 0) {
    lines.push('', `Не нашёл никто (${report.missed.length}):`);
    report.missed.forEach((b) => lines.push(`• ${b.code} — ${b.title}`));
  }
  return lines.join('\n');
}
