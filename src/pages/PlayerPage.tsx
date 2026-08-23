import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug,
  CheckCircle2,
  Clock,
  Cloud,
  CloudOff,
  Copy,
  Flag,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Hourglass,
  Lock,
  Trash2,
} from 'lucide-react';
import { config } from '@/config';
import { Alert, Badge, Button, Modal, Spinner, cn } from '@/components/ui';
import { formatDuration } from '@/lib/format';
import { newId, storage } from '@/lib/storage';
import { encodeSnapshot, fetchResults, fetchRound, isOnlineMode, pushProgress } from '@/lib/sync';
import {
  AREA_LABELS,
  ROUND_STATUS_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
  type Area,
  type BugReport,
  type Participant,
  type PublishedResults,
  type RoundState,
  type Severity,
} from '@/lib/types';
import { RoundResults } from '@/components/RoundResults';
import { ShoppingCartApp } from '@/sandbox/ShoppingCart';

type SyncState = 'idle' | 'syncing' | 'ok' | 'error';

/**
 * Черновик дефекта. Серьёзность участник не указывает — она берётся из эталонного
 * списка при разборе, поэтому здесь стоит нейтральное значение-заглушка.
 */
const EMPTY_DRAFT = {
  title: '',
  steps: '',
  expected: '',
  actual: '',
  severity: 'major' as Severity,
  area: 'catalog' as Area,
};

export const PlayerPage: React.FC<{
  login: string;
  onLogout: () => void;
  /** Задан только в демо-режиме: быстрый переход в админку без пароля. */
  onSwitchRole?: () => void;
}> = ({ login, onLogout, onSwitchRole }) => {
  const [participant, setParticipant] = useState<Participant>(() => {
    const saved = storage.getParticipant();
    if (saved && saved.login === login) return saved;
    const now = new Date().toISOString();
    return { login, round: 0, startedAt: now, lastSeenAt: now, finishedAt: '', peeked: false };
  });
  const [reports, setReports] = useState<BugReport[]>(() =>
    storage.getReports().filter((r) => r.login === login),
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BugReport | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickError, setQuickError] = useState('');
  const [justAdded, setJustAdded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [round, setRound] = useState<RoundState>(() => storage.getRound());
  /** Итоги раунда, опубликованные организатором. null — их ещё нет. */
  const [results, setResults] = useState<PublishedResults | null>(() => storage.getResults());

  // Держим свежие данные в ref, чтобы интервал синхронизации не пересоздавался на каждый ввод.
  const latest = useRef({ participant, reports: [] as BugReport[] });

  useEffect(() => storage.setParticipant(participant), [participant]);
  useEffect(() => storage.setReports(reports), [reports]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Состояние раунда: в онлайне спрашиваем сервер, в офлайне читаем localStorage,
  // куда его пишет админка, открытая в этом же браузере.
  // Актуальные итоги для колбэков опроса: перезапускать интервал из-за них незачем.
  const resultsRef = useRef(results);
  resultsRef.current = results;

  const applyResults = useCallback((next: PublishedResults) => {
    storage.setResults(next);
    setResults(next);
  }, []);

  useEffect(() => {
    const poll = () => {
      if (isOnlineMode()) {
        fetchRound()
          .then((next) => {
            setRound(next);
            // Итоги спрашиваем только после закрытия раунда и только пока их нет:
            // опубликованные, они уже не меняются, а лишний запрос — это квота.
            if (
              next.status === 'finished' &&
              next.number > 0 &&
              resultsRef.current?.round !== next.number
            ) {
              fetchResults(next.number)
                .then((published) => {
                  if (published) applyResults(published);
                })
                .catch(() => undefined);
            }
          })
          .catch(() => undefined);
      } else {
        setRound(storage.getRound());
        const saved = storage.getResults();
        if (saved && saved.round !== resultsRef.current?.round) setResults(saved);
      }
    };
    poll();
    if (!isOnlineMode()) {
      const offline = setInterval(poll, 2_000);
      return () => clearInterval(offline);
    }
    // Пока ждём старта, спрашиваем сервер чаще: каждая лишняя секунда до открытия
    // витрины — это фора для тех, кому ответ пришёл раньше. Во время раунда частить
    // незачем, а в скрытой вкладке не опрашиваем вовсе, чтобы не жечь квоту.
    let timer = 0;
    const schedule = () => {
      const hidden = document.visibilityState === 'hidden';
      // Чаще всего опрашиваем до старта: каждая лишняя секунда там — фора соседу.
      // После закрытия раунда ждём только публикации итогов — это не гонка.
      const delay = hidden
        ? config.roundPollHiddenMs
        : round.status === 'idle'
          ? config.roundPollWaitingMs
          : round.status === 'running'
            ? config.roundPollRunningMs
            : config.roundPollHiddenMs;
      timer = window.setTimeout(() => {
        poll();
        schedule();
      }, delay);
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(timer);
      poll();
      schedule();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [round.status, applyResults]);

  // Отсчёт идёт от старта раунда, а не от входа участника: у всех одинаковое время.
  const roundStartMs = round.startedAt ? new Date(round.startedAt).getTime() : Date.now();
  const elapsedSec = round.status === 'idle' ? 0 : Math.max(0, Math.floor((now - roundStartMs) / 1000));
  const endsMs = round.endsAt ? new Date(round.endsAt).getTime() : 0;
  const remainingSec = endsMs ? Math.floor((endsMs - now) / 1000) : null;
  const timeIsUp = remainingSec !== null && remainingSec <= 0;

  /** Дефекты принимаются, только пока раунд идёт и время не вышло. */
  const roundOpen = round.status === 'running' && !timeIsUp && !participant.finishedAt;

  const lockReason = participant.finishedAt
    ? 'Вы сдали результат — приём ваших дефектов закрыт.'
    : round.status === 'idle'
      ? 'Раунд ещё не начался. Витрина откроется у всех одновременно со стартом.'
      : round.status === 'finished'
        ? 'Раунд завершён организатором. Приём дефектов закрыт.'
        : timeIsUp
          ? 'Время раунда вышло. Приём дефектов закрыт.'
          : '';

  // Новый раунд обнуляет прогресс участника: прошлые находки уже у организатора.
  useEffect(() => {
    if (round.status !== 'running' || round.number === 0) return;
    if (participant.round === round.number) return;
    setParticipant((prev) => ({
      login,
      round: round.number,
      startedAt: round.startedAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      finishedAt: '',
      // Отметку о подглядывании не сбрасываем: она относится к участнику, а не к раунду.
      peeked: prev.peeked,
    }));
    // Репорты прошлых раундов не удаляем: в офлайн-режиме организатор ещё не забрал
    // их кодом результата. Показываем только текущий раунд, храним всё.
    setFinishOpen(false);
  }, [round, participant.round, login]);

  const storeRef = useRef<HTMLDivElement | null>(null);
  // Актуальное состояние раунда для колбэков наблюдателя: они срабатывают асинхронно
  // и могут выполниться уже после того, как раунд открылся.
  const roundOpenRef = useRef(roundOpen);
  roundOpenRef.current = roundOpen;

  /**
   * Оверлей — защита на честность: класс с размытием снимается из инструментов
   * разработчика в один клик, и помешать этому со статики нельзя. Зато можно
   * зафиксировать сам факт и показать организатору.
   */
  const markPeeked = useCallback(() => {
    if (roundOpenRef.current) return;
    setParticipant((prev) => (prev.peeked ? prev : { ...prev, peeked: true }));
  }, []);

  useEffect(() => {
    if (roundOpen) return;
    const node = storeRef.current;
    if (!node) return;

    // Клики по самой заглушке легальны — реагируем только на касания витрины,
    // которые вообще возможны лишь со снятым pointer-events-none.
    const onInteract = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-testid="store-overlay"]')) return;
      markPeeked();
    };
    node.addEventListener('pointerdown', onInteract, true);

    const observer = new MutationObserver((records) => {
      // При старте раунда React сам убирает размытие и заглушку — это не подглядывание.
      if (roundOpenRef.current) return;
      for (const record of records) {
        if (record.type === 'attributes' && record.target === node.firstElementChild) {
          const cls = (record.target as HTMLElement).className;
          if (!cls.includes('blur-') || !cls.includes('pointer-events-none')) {
            markPeeked();
            return;
          }
        }
        const removedOverlay = [...record.removedNodes].some(
          (n) => n instanceof HTMLElement && n.dataset.testid === 'store-overlay',
        );
        if (removedOverlay) {
          markPeeked();
          return;
        }
      }
    });
    observer.observe(node, { attributes: true, attributeFilter: ['class', 'style'], childList: true });

    return () => {
      node.removeEventListener('pointerdown', onInteract, true);
      observer.disconnect();
    };
  }, [roundOpen, markPeeked]);

  const sync = useCallback(async (silent: boolean) => {
    if (!isOnlineMode()) return;
    if (!silent) setSyncState('syncing');
    try {
      const snapshot = {
        ...latest.current.participant,
        lastSeenAt: new Date().toISOString(),
      };
      const deleted = storage.getDeletedIds();
      const result = await pushProgress(snapshot, latest.current.reports, deleted);
      storage.addSyncedIds(result.accepted);
      if (deleted.length > 0) storage.clearDeletedIds();
      // Сервер возвращает актуальный раунд — узнаём о старте и закрытии без лишнего запроса.
      if (result.round) setRound(result.round);
      // И собственные строки участника со стороны сервера: вердикты организатора
      // (иначе всё висело бы «на проверке») плюс находки, которых нет локально, —
      // так список не пустеет в другом браузере и после очистки данных.
      if (result.verdicts?.length) {
        const fromServer = result.verdicts.filter((v) => v && v.id && v.login === login);
        const byId = new Map(fromServer.map((v) => [v.id, v]));
        setReports((prev) => {
          const known = new Set(prev.map((r) => r.id));
          const patched = prev.map((r) => {
            const v = byId.get(r.id);
            return v && (v.status !== r.status || v.score !== r.score)
              ? { ...r, status: v.status, score: v.score, reviewComment: v.reviewComment }
              : r;
          });
          const missing = fromServer.filter((v) => !known.has(v.id));
          return missing.length > 0 ? [...missing, ...patched] : patched;
        });
      }
      setSyncState('ok');
      setSyncError(
        result.rejected && result.rejected.length > 0
          ? `Сервер не принял дефектов: ${result.rejected.length} (заведены вне раунда)`
          : '',
      );
    } catch (err) {
      setSyncState('error');
      setSyncError(err instanceof Error ? err.message : 'Ошибка отправки');
    }
  }, []);

  useEffect(() => {
    if (!isOnlineMode()) return;
    void sync(true);
    const t = setInterval(() => void sync(true), config.syncIntervalMs);
    return () => clearInterval(t);
  }, [sync]);

  // Пытаемся не потерять последние правки при закрытии вкладки.
  useEffect(() => {
    const handler = () => {
      if (!isOnlineMode() || !navigator.sendBeacon) return;
      const body = JSON.stringify({
        action: 'submit',
        participant: { ...latest.current.participant, lastSeenAt: new Date().toISOString() },
        reports: latest.current.reports,
      });
      navigator.sendBeacon(config.syncEndpoint, new Blob([body], { type: 'text/plain' }));
    };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, []);

  function addReport(draft: typeof EMPTY_DRAFT) {
    // Страховка на случай, если раунд закрылся между отрисовкой и нажатием.
    if (!roundOpen) {
      setQuickError(lockReason || 'Приём дефектов закрыт');
      return;
    }
    const stamp = new Date().toISOString();
    const report: BugReport = {
      id: newId(),
      round: round.number,
      login,
      ...draft,
      createdAt: stamp,
      elapsedSec,
      status: 'pending',
      score: 0,
      reviewComment: '',
      updatedAt: stamp,
    };
    setReports((prev) => [report, ...prev]);
    setTimeout(() => void sync(true), 0);
  }

  function saveReport(draft: typeof EMPTY_DRAFT) {
    if (editing) {
      const stamp = new Date().toISOString();
      setReports((prev) =>
        prev.map((r) => (r.id === editing.id ? { ...r, ...draft, updatedAt: stamp } : r)),
      );
      setTimeout(() => void sync(true), 0);
    } else {
      addReport(draft);
    }
    setFormOpen(false);
    setEditing(null);
  }

  /** Быстрое заведение одной строкой: заголовок и серьёзность, остальное можно дописать позже. */
  function quickAdd() {
    const title = quickTitle.trim();
    if (title.length < 5) {
      setQuickError('Опишите проблему хотя бы парой слов');
      return;
    }
    setQuickError('');
    addReport({ ...EMPTY_DRAFT, title });
    setQuickTitle('');
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1800);
  }

  function deleteReport(id: string) {
    setReports((prev) => prev.filter((r) => r.id !== id));
    // Локального удаления мало: без этого строка осталась бы у организатора.
    storage.addDeletedId(id);
    setTimeout(() => void sync(true), 0);
  }

  /** Участник досрочно сдаёт результат: его ввод закрывается, время фиксируется. */
  function submitResult() {
    const finished = { ...participant, finishedAt: new Date().toISOString() };
    setParticipant(finished);
    latest.current = { participant: finished, reports: roundReports };
    setFinishOpen(true);
    void sync(false);
  }

  /** Участник видит и сдаёт только находки текущего раунда. */
  const roundReports = useMemo(
    () => reports.filter((r) => r.round === round.number),
    [reports, round.number],
  );

  latest.current = { participant, reports: roundReports };

  const stats = useMemo(() => ({ total: roundReports.length }), [roundReports]);

  /**
   * Итоги показываем вместо витрины: раунд уже закрыт, магазин под размытием никому
   * не нужен, а личный результат — то, ради чего участник возвращается на страницу.
   */
  const showResults = results !== null && results.round === round.number && round.number > 0;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white">
              <Bug className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold">{config.title}</p>
              <p className="text-xs text-slate-500">{login}</p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                'gap-1',
                roundOpen
                  ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                  : 'border-rose-200 bg-rose-100 text-rose-800',
              )}
              title={round.title || 'Состояние раунда'}
              data-testid="round-status"
            >
              {roundOpen ? <Clock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {round.status === 'idle'
                ? 'раунд не начался'
                : !roundOpen
                  ? 'приём закрыт'
                  : remainingSec === null
                    ? `раунд ${round.number} · ${formatDuration(elapsedSec)}`
                    : `раунд ${round.number} · ${formatDuration(remainingSec)}`}
            </Badge>

            <SyncBadge state={syncState} error={syncError} onRetry={() => void sync(false)} />

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setListOpen(true)}
              data-testid="open-bug-list"
            >
              <Flag className="h-4 w-4" />
              Мои дефекты
              <span className="ml-0.5 rounded-full bg-orange-100 px-1.5 text-xs font-bold text-orange-800">
                {stats.total}
              </span>
            </Button>

            <Button size="sm" variant="secondary" onClick={submitResult}
              disabled={!roundOpen}
              data-testid="finish-round"
            >
              <CheckCircle2 className="h-4 w-4" />
              Сдать результат
            </Button>
            {onSwitchRole && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onSwitchRole}
                data-testid="go-admin"
                title="Демо-режим: админка открывается без пароля"
              >
                <ShieldCheck className="h-4 w-4" />
                Админка
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onLogout}
              aria-label={onSwitchRole ? 'Сменить участника' : 'Выйти'}
              title={onSwitchRole ? 'Сменить участника' : 'Выйти'}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mx-auto max-w-[1600px] px-4 pb-3">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              quickAdd();
            }}
          >
            <div className="relative min-w-[240px] flex-1">
              <Flag className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="field pl-9"
                placeholder={
                  roundOpen
                    ? 'Что сломалось? Опишите одной строкой и нажмите Enter'
                    : 'Приём дефектов закрыт'
                }
                disabled={!roundOpen}
                value={quickTitle}
                onChange={(e) => {
                  setQuickTitle(e.target.value);
                  if (quickError) setQuickError('');
                }}
                data-testid="quick-title"
              />
            </div>

            <Button type="submit" size="md" disabled={!roundOpen} data-testid="quick-add">
              <Plus className="h-4 w-4" />
              Добавить
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setFormOpen(true)}
              disabled={!roundOpen}
              data-testid="open-bug-form"
              title="Открыть полную форму: шаги, ожидаемый и фактический результат"
            >
              Подробно
            </Button>

            {quickError && <span className="text-sm text-rose-600">{quickError}</span>}
            {justAdded && !quickError && (
              <span className="flex items-center gap-1 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Записал
              </span>
            )}
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6">
        {!roundOpen && !showResults && (
          <div className="mb-4">
            <Alert tone={round.status === 'idle' ? 'info' : 'error'}>
              <span className="font-medium">{ROUND_STATUS_LABELS[round.status]}.</span> {lockReason}
              {roundReports.length > 0 && ` Заведено дефектов: ${roundReports.length}.`}
            </Alert>
          </div>
        )}
        {roundOpen && round.title && (
          <div className="mb-4">
            <Alert tone="success">
              Идёт раунд {round.number}: {round.title}
            </Alert>
          </div>
        )}

        {showResults ? (
          <RoundResults results={results} login={login} reports={roundReports} />
        ) : (
        <div className="relative" ref={storeRef}>
          {/*
            Пока раунд не идёт, витрина закрыта: иначе тот, кто вошёл раньше, успел бы
            изучить магазин заранее. Компонент не размонтируем — так состояние корзины
            не мигает при открытии, а сам старт для всех наступает одновременно.
          */}
          <div
            className={cn(!roundOpen && 'pointer-events-none select-none blur-[14px]')}
            aria-hidden={!roundOpen}
          >
            <ShoppingCartApp preview={!roundOpen} />
          </div>

          {!roundOpen && (
            <div
              className="absolute inset-0 z-20 flex items-start justify-center rounded-2xl bg-slate-900/60 p-6 backdrop-blur-md"
              data-testid="store-overlay"
            >
              <div className="mt-16 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl">
                <span
                  className={cn(
                    'mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl',
                    round.status === 'idle'
                      ? 'bg-orange-100 text-orange-600'
                      : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {round.status === 'idle' ? (
                    <Hourglass className="h-7 w-7" />
                  ) : (
                    <Lock className="h-7 w-7" />
                  )}
                </span>

                <h2 className="text-lg font-semibold">
                  {round.status === 'idle'
                    ? 'Магазин откроется со стартом раунда'
                    : participant.finishedAt
                      ? 'Вы сдали результат'
                      : 'Раунд завершён'}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {round.status === 'idle'
                    ? 'Вы в игре — ждём остальных. Витрина закрыта, чтобы никто не изучил её заранее: у всех будет одинаковое время.'
                    : lockReason}
                </p>

                {round.status === 'idle' && (
                  <p className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">
                    <Spinner className="h-4 w-4" />
                    Откроется автоматически, обновлять страницу не нужно
                  </p>
                )}

                {roundReports.length > 0 && (
                  <p className="mt-3 text-sm text-slate-600">
                    Ваших находок в раунде: <b>{roundReports.length}</b> — их видно по кнопке
                    «Мои дефекты».
                  </p>
                )}

                <p className="mt-4 text-xs text-slate-400">
                  Вы вошли как {login}
                  {round.number > 0 && ` · раунд ${round.number}`}
                </p>
              </div>
            </div>
          )}
        </div>
        )}
      </main>

      <BugListModal
        canEdit={roundOpen}
        open={listOpen}
        onClose={() => setListOpen(false)}
        reports={roundReports}
        stats={stats}
        onCreate={() => {
          setListOpen(false);
          setFormOpen(true);
        }}
        onEdit={(r) => {
          setListOpen(false);
          setEditing(r);
          setFormOpen(true);
        }}
        onDelete={deleteReport}
      />

      <BugFormModal
        open={formOpen}
        initialTitle={quickTitle}
        initial={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSave={saveReport}
      />

      <FinishModal
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        participant={participant}
        reports={roundReports}
        syncState={syncState}
        syncError={syncError}
      />
    </div>
  );
};

const SyncBadge: React.FC<{ state: SyncState; error: string; onRetry: () => void }> = ({
  state,
  error,
  onRetry,
}) => {
  if (!isOnlineMode()) {
    return (
      <Badge className="gap-1" title="Endpoint не настроен — данные хранятся только в браузере">
        <CloudOff className="h-3.5 w-3.5" />
        офлайн
      </Badge>
    );
  }
  if (state === 'error') {
    return (
      <button onClick={onRetry} title={error}>
        <Badge className="gap-1 border-rose-200 bg-rose-100 text-rose-800">
          <RefreshCw className="h-3.5 w-3.5" />
          ошибка отправки
        </Badge>
      </button>
    );
  }
  return (
    <Badge className="gap-1 border-emerald-200 bg-emerald-100 text-emerald-800">
      {state === 'syncing' ? <Spinner className="h-3 w-3" /> : <Cloud className="h-3.5 w-3.5" />}
      сохранено
    </Badge>
  );
};

const BugListModal: React.FC<{
  /** Правки разрешены только пока раунд идёт: после закрытия список только для чтения. */
  canEdit: boolean;
  open: boolean;
  onClose: () => void;
  reports: BugReport[];
  stats: { total: number };
  onCreate: () => void;
  onEdit: (r: BugReport) => void;
  onDelete: (id: string) => void;
}> = ({ canEdit, open, onClose, reports, stats, onCreate, onEdit, onDelete }) => (
  <Modal open={open} onClose={onClose} title={`Мои дефекты — ${stats.total}`} wide>
    <div className="space-y-3">
      {reports.length === 0 ? (
        <div className="py-10 text-center">
          <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Flag className="h-6 w-6" />
          </span>
          <p className="font-medium">Пока ничего не заведено</p>
          <p className="mt-1 text-sm text-slate-500">
            Нашли проблему в магазине — опишите её, время фиксируется автоматически.
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Заведено находок: {stats.total}. Баллы начислит организатор по итогам проверки.
        </p>
      )}

      <div className="max-h-[55vh] space-y-2 overflow-y-auto">
        {reports.map((r) => {
          // Разобранное организатором не трогаем: вердикт вынесен по конкретному тексту.
          const editable = canEdit && r.status === 'pending';
          return (
          <div key={r.id} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start gap-2">
              <p className="flex-1 font-medium leading-tight">{r.title}</p>
              {editable ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(r)}
                    aria-label="Редактировать"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(r.id)}
                    aria-label="Удалить"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                  </Button>
                </>
              ) : (
                <span
                  className="mt-1 text-slate-400"
                  title={
                    r.status !== 'pending'
                      ? 'Организатор уже проверил эту находку — изменить её нельзя'
                      : 'Раунд закрыт — изменить находку нельзя'
                  }
                >
                  <Lock className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge>{AREA_LABELS[r.area]}</Badge>
              <Badge className={STATUS_STYLES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
              <Badge className="gap-1">
                <Clock className="h-3 w-3" />
                {formatDuration(r.elapsedSec)}
              </Badge>
              {r.status === 'accepted' && r.score > 0 && (
                <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">
                  +{r.score} баллов
                </Badge>
              )}
            </div>
            {r.reviewComment && (
              <p className="mt-1 text-xs text-slate-500">{r.reviewComment}</p>
            )}
          </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
        {canEdit && (
          <Button onClick={onCreate}>
            <Plus className="h-4 w-4" />
            Завести дефект
          </Button>
        )}
      </div>
    </div>
  </Modal>
);

const BugFormModal: React.FC<{
  open: boolean;
  initial: BugReport | null;
  /** Черновик из строки быстрого ввода — подставляется при создании нового дефекта. */
  initialTitle?: string;
  onClose: () => void;
  onSave: (draft: typeof EMPTY_DRAFT) => void;
}> = ({ open, initial, initialTitle, onClose, onSave }) => {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setDraft(
      initial
        ? {
            title: initial.title,
            steps: initial.steps,
            expected: initial.expected,
            actual: initial.actual,
            severity: initial.severity,
            area: initial.area,
          }
        : { ...EMPTY_DRAFT, title: initialTitle ?? '' },
    );
  }, [open, initial, initialTitle]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Обязателен только заголовок: остальное участник дописывает, если есть время.
    if (draft.title.trim().length < 5) return setError('Опишите проблему хотя бы парой слов');
    onSave({
      ...draft,
      title: draft.title.trim(),
      steps: draft.steps.trim(),
      expected: draft.expected.trim(),
      actual: draft.actual.trim(),
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Редактирование дефекта' : 'Новый дефект'}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Заголовок</label>
          <input
            className="field"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Кратко: что и где сломано"
            autoFocus
            data-testid="bug-title"
          />
        </div>
        <div>
          <div>
            <label className="label">Раздел — необязательно</label>
            <select
              className="field"
              value={draft.area}
              onChange={(e) => setDraft({ ...draft, area: e.target.value as Area })}
              data-testid="bug-area"
            >
              {(Object.keys(AREA_LABELS) as Area[]).map((a) => (
                <option key={a} value={a}>
                  {AREA_LABELS[a]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Шаги воспроизведения — необязательно</label>
          <textarea
            className="field min-h-[96px]"
            value={draft.steps}
            onChange={(e) => setDraft({ ...draft, steps: e.target.value })}
            placeholder={'1. Открыть каталог\n2. Ввести «ноутбук» в поиск\n3. …'}
            data-testid="bug-steps"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Ожидаемый — необязательно</label>
            <textarea
              className="field min-h-[72px]"
              value={draft.expected}
              onChange={(e) => setDraft({ ...draft, expected: e.target.value })}
              data-testid="bug-expected"
            />
          </div>
          <div>
            <label className="label">Фактический — необязательно</label>
            <textarea
              className="field min-h-[72px]"
              value={draft.actual}
              onChange={(e) => setDraft({ ...draft, actual: e.target.value })}
              data-testid="bug-actual"
            />
          </div>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" data-testid="save-bug">
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const FinishModal: React.FC<{
  open: boolean;
  onClose: () => void;
  participant: Participant;
  reports: BugReport[];
  syncState: SyncState;
  syncError: string;
}> = ({ open, onClose, participant, reports, syncState, syncError }) => {
  const [copied, setCopied] = useState(false);
  const code = useMemo(
    () => (open ? encodeSnapshot({ participant, reports }) : ''),
    [open, participant, reports],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Раунд завершён">
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Заведено дефектов: <b>{reports.length}</b>. Время раунда:{' '}
          <b>
            {formatDuration(
              Math.floor(
                (new Date(participant.finishedAt || Date.now()).getTime() -
                  new Date(participant.startedAt).getTime()) /
                  1000,
              ),
            )}
          </b>
          .
        </p>

        {isOnlineMode() ? (
          syncState === 'error' ? (
            <Alert tone="error">
              Не удалось отправить результаты: {syncError}. Скопируйте код ниже и передайте
              организатору.
            </Alert>
          ) : (
            <Alert tone="success">Результаты отправлены организатору.</Alert>
          )
        ) : (
          <Alert tone="info">
            Офлайн-режим: скопируйте код и отправьте его организатору любым удобным способом.
          </Alert>
        )}

        {(!isOnlineMode() || syncState === 'error') && (
          <>
            <textarea className="field h-32 font-mono text-xs" readOnly value={code} />
            <Button onClick={copy} className="w-full">
              <Copy className="h-4 w-4" />
              {copied ? 'Скопировано' : 'Скопировать код результата'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
};
