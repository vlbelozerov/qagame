import React, { useMemo, useState } from 'react';
import { Award, CheckCircle2, Clock, Copy, Sparkles, Trophy, XCircle } from 'lucide-react';
import { Alert, Badge, Button, cn } from '@/components/ui';
import { formatDuration, plural, pluralWord } from '@/lib/format';
import {
  STATUS_LABELS,
  STATUS_STYLES,
  type BugReport,
  type PublishedResults,
} from '@/lib/types';

/**
 * Личные итоги игры: то, чем участник хвастается в чате.
 *
 * Данные приходят готовыми от организатора — участник ничего не пересчитывает.
 * Сам по себе экран не появляется: пока итоги не опубликованы, его нет вовсе.
 */

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export const GameResults: React.FC<{
  results: PublishedResults;
  login: string;
  /** Собственные находки участника — с вердиктами организатора. */
  reports: BugReport[];
}> = ({ results, login, reports }) => {
  const [copied, setCopied] = useState(false);

  const me = useMemo(
    () => results.standings.find((row) => row.login === login) ?? null,
    [results.standings, login],
  );

  const myNominations = useMemo(
    () => results.nominations.filter((n) => n.winnerLogins.includes(login)),
    [results.nominations, login],
  );

  // Показываем десятку плюс собственную строку, если участник в неё не попал:
  // прокручивать сотню логинов ради своего места никто не станет.
  const topRows = results.standings.slice(0, 10);
  const meOutsideTop = me && !topRows.some((row) => row.login === me.login) ? me : null;

  const myReports = useMemo(
    () => [...reports].sort((a, b) => a.elapsedSec - b.elapsedSec),
    [reports],
  );

  const summaryText = useMemo(() => {
    const lines = [
      `Итоги игры${results.title ? `: ${results.title}` : ''}`,
      me
        ? `${login} — ${me.place} место из ${results.standings.length}, ${plural(me.score, 'балл', 'балла', 'баллов')}`
        : `${login} — вне зачёта`,
      me ? `Засчитано находок: ${me.accepted} из ${me.total}` : '',
      ...myNominations.map((n) => `${n.emoji} ${n.title}: ${n.detail}`),
    ];
    return lines.filter(Boolean).join('\n');
  }, [results, me, login, myNominations]);

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="game-results">
      {/* --- Главное: место и баллы --- */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-orange-500 to-rose-500 p-6 text-white shadow-lg">
        <p className="text-sm font-medium uppercase tracking-wide text-white/80">
          Итоги игры{results.title ? ` · ${results.title}` : ''}
        </p>

        {me ? (
          <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="flex items-baseline gap-2 text-5xl font-black leading-none">
                <span>{MEDALS[me.place] ?? ''}</span>
                <span data-testid="my-place">{me.place}</span>
                <span className="text-2xl font-semibold text-white/80">
                  место из {results.standings.length}
                </span>
              </p>
              <p className="mt-2 text-white/90">{login}</p>
            </div>
            <div>
              <p className="text-4xl font-black leading-none" data-testid="my-score">
                {me.score}
              </p>
              <p className="text-sm text-white/80">
                {pluralWord(me.score, 'балл', 'балла', 'баллов')}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-lg font-semibold">
            Вас нет в зачёте — находок от вас не поступало.
          </p>
        )}
      </div>

      {me && (
        <div className="grid gap-3 sm:grid-cols-4">
          <ResultStat
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Засчитано"
            value={me.accepted}
            tone="good"
          />
          <ResultStat
            icon={<XCircle className="h-4 w-4" />}
            label="Отклонено"
            value={me.rejected + me.duplicate}
          />
          <ResultStat
            icon={<Sparkles className="h-4 w-4" />}
            label="Нашли только вы"
            value={me.unique}
            tone={me.unique > 0 ? 'good' : undefined}
          />
          <ResultStat
            icon={<Clock className="h-4 w-4" />}
            label="Первая находка"
            value={me.firstAcceptedSec >= 0 ? formatDuration(me.firstAcceptedSec) : '—'}
          />
        </div>
      )}

      {/* --- Личные номинации --- */}
      {myNominations.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <Award className="h-4 w-4 text-orange-600" />
            Ваши номинации
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {myNominations.map((n) => (
              <div
                key={n.key}
                className="rounded-xl border border-orange-200 bg-orange-50 p-3"
                data-testid={`my-nomination-${n.key}`}
              >
                <p className="font-semibold">
                  {n.emoji} {n.title}
                </p>
                <p className="text-sm text-slate-600">{n.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- Разбор собственных находок --- */}
      <div>
        <h3 className="mb-2 font-semibold">Ваши находки — что засчитали</h3>
        {myReports.length === 0 ? (
          <Alert tone="info">Вы не завели ни одного дефекта.</Alert>
        ) : (
          <div className="space-y-2">
            {myReports.map((r) => (
              <div
                key={r.id}
                className={cn(
                  'rounded-xl border p-3',
                  r.status === 'accepted' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200',
                )}
              >
                <div className="flex flex-wrap items-start gap-2">
                  <p className="flex-1 font-medium leading-tight">{r.title}</p>
                  <Badge className={STATUS_STYLES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                  {r.status === 'accepted' && r.score > 0 && (
                    <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">
                      +{r.score}
                    </Badge>
                  )}
                  <Badge className="gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(r.elapsedSec)}
                  </Badge>
                </div>
                {r.reviewComment && (
                  <p className="mt-1 text-sm text-slate-500">{r.reviewComment}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* --- Общая таблица --- */}
      <div>
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <Trophy className="h-4 w-4 text-orange-600" />
          Таблица результатов
        </h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Место</th>
                <th className="px-3 py-2">Участник</th>
                <th className="px-3 py-2">Баллы</th>
                <th className="px-3 py-2">Засчитано</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map((row) => (
                <StandingTableRow key={row.login} row={row} isMe={row.login === login} />
              ))}
              {meOutsideTop && (
                <>
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-1 text-center text-slate-400" colSpan={4}>
                      …
                    </td>
                  </tr>
                  <StandingTableRow row={meOutsideTop} isMe />
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Что нашли все вместе --- */}
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="text-sm text-slate-600">
          {/* Эталонного списка у организатора могло не быть — тогда «из N» не пишем. */}
          Все вместе нашли <b>{results.foundBugs}</b>
          {results.knownBugs > 0 ? (
            <>
              {' '}
              из <b>{results.knownBugs}</b> заложенных дефектов
            </>
          ) : (
            ' дефектов'
          )}{' '}
          · участников: {results.participants} · заявок: {results.totalReports}.
        </p>
        {results.missed.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Не нашёл никто: {results.missed.length} — посмотреть
            </summary>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
              {results.missed.map((bug) => (
                <li key={bug.code}>
                  <span className="font-mono text-xs text-slate-400">{bug.code}</span> {bug.title}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="flex justify-end">
        <Button variant="secondary" onClick={copySummary} data-testid="copy-my-results">
          <Copy className="h-4 w-4" />
          {copied ? 'Скопировано' : 'Скопировать мои итоги'}
        </Button>
      </div>
    </div>
  );
};

const StandingTableRow: React.FC<{
  row: PublishedResults['standings'][number];
  isMe: boolean;
}> = ({ row, isMe }) => (
  <tr
    className={cn('border-t border-slate-100', isMe && 'bg-orange-50 font-semibold')}
    data-testid={isMe ? 'standings-me' : undefined}
  >
    <td className="px-3 py-1.5">
      {MEDALS[row.place] ?? ''} {row.place}
    </td>
    <td className="px-3 py-1.5">{row.login}</td>
    <td className="px-3 py-1.5">{row.score}</td>
    <td className="px-3 py-1.5 text-slate-500">{row.accepted}</td>
  </tr>
);

const ResultStat: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: 'good';
}> = ({ icon, label, value, tone }) => (
  <div className="rounded-xl border border-slate-200 p-3">
    <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500">
      {icon}
      {label}
    </p>
    <p className={cn('mt-1 text-2xl font-bold', tone === 'good' && 'text-emerald-700')}>{value}</p>
  </div>
);
