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
import { encodeSnapshot, fetchResults, fetchGame, isOnlineMode, pushProgress } from '@/lib/sync';
import {
  GAME_STATUS_LABELS,
  type Area,
  type BugReport,
  type Participant,
  type PublishedResults,
  type GameState,
  type Severity,
} from '@/lib/types';
import { GameResults } from '@/components/GameResults';
import { ShoppingCartApp } from '@/sandbox/ShoppingCart';

type SyncState = 'idle' | 'syncing' | 'ok' | 'error';

/**
 * Значения полей, которые участник не заполняет: находка заводится одной строкой.
 * Серьёзность берётся из эталонного списка при разборе, поэтому здесь заглушка.
 */
const REPORT_DEFAULTS = {
  steps: '',
  expected: '',
  actual: '',
  severity: 'major' as Severity,
  area: 'other' as Area,
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
  /** Правка формулировки уже заведённой находки — тем же одним полем. */
  const [editing, setEditing] = useState<BugReport | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickError, setQuickError] = useState('');
  const [justAdded, setJustAdded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [game, setGame] = useState<GameState>(() => storage.getGame());
  /** Итоги игры, опубликованные организатором. null — их ещё нет. */
  const [results, setResults] = useState<PublishedResults | null>(() => storage.getResults());

  // Держим свежие данные в ref, чтобы интервал синхронизации не пересоздавался на каждый ввод.
  const latest = useRef({ participant, reports: [] as BugReport[] });

  useEffect(() => storage.setParticipant(participant), [participant]);
  useEffect(() => storage.setReports(reports), [reports]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Состояние игры: в онлайне спрашиваем сервер, в офлайне читаем localStorage,
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
        fetchGame()
          .then((next) => {
            setGame(next);
            // Итоги спрашиваем только после завершения игры и только пока их нет:
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
        setGame(storage.getGame());
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
    // витрины — это фора для тех, кому ответ пришёл раньше. Во время игры частить
    // незачем, а в скрытой вкладке не опрашиваем вовсе, чтобы не жечь квоту.
    let timer = 0;
    const schedule = () => {
      const hidden = document.visibilityState === 'hidden';
      // Чаще всего опрашиваем до старта: каждая лишняя секунда там — фора соседу.
      // После завершения игры ждём только публикации итогов — это не гонка.
      const delay = hidden
        ? config.pollHiddenMs
        : game.status === 'idle'
          ? config.pollWaitingMs
          : game.status === 'running'
            ? config.pollRunningMs
            : config.pollHiddenMs;
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
  }, [game.status, applyResults]);

  // Отсчёт идёт от старта игры, а не от входа участника: у всех одинаковое время.
  const gameStartMs = game.startedAt ? new Date(game.startedAt).getTime() : Date.now();
  const elapsedSec = game.status === 'idle' ? 0 : Math.max(0, Math.floor((now - gameStartMs) / 1000));
  const endsMs = game.endsAt ? new Date(game.endsAt).getTime() : 0;
  const remainingSec = endsMs ? Math.floor((endsMs - now) / 1000) : null;
  const timeIsUp = remainingSec !== null && remainingSec <= 0;

  /** Дефекты принимаются, только пока игра идёт и время не вышло. */
  const gameOpen = game.status === 'running' && !timeIsUp && !participant.finishedAt;

  /**
   * Причина блокировки — без повтора самого статуса: он выводится рядом отдельной
   * строкой и в заглушке, и в плашке над витриной.
   */
  const lockReason = participant.finishedAt
    ? 'Вы сдали результат — приём ваших дефектов закрыт.'
    : game.status === 'idle'
      ? 'Витрина откроется у всех одновременно со стартом.'
      : game.status === 'finished'
        ? 'Приём дефектов закрыт — дождитесь итогов.'
        : timeIsUp
          ? 'Время вышло, приём дефектов закрыт — дождитесь итогов.'
          : '';

  // Новый запуск игры обнуляет прогресс участника: прошлые находки уже у организатора.
  useEffect(() => {
    if (game.status !== 'running' || game.number === 0) return;
    if (participant.round === game.number) return;
    setParticipant((prev) => ({
      login,
      round: game.number,
      startedAt: game.startedAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      finishedAt: '',
      // Отметку о подглядывании не сбрасываем: она относится к участнику, а не к игре.
      peeked: prev.peeked,
    }));
    // Репорты прошлых запусков не удаляем: в офлайн-режиме организатор ещё не забрал
    // их кодом результата. Показываем только текущую игру, храним всё.
    setFinishOpen(false);
  }, [game, participant.round, login]);

  const storeRef = useRef<HTMLDivElement | null>(null);
  // Актуальное состояние игры для колбэков наблюдателя: они срабатывают асинхронно
  // и могут выполниться уже после того, как витрина открылась.
  const gameOpenRef = useRef(gameOpen);
  gameOpenRef.current = gameOpen;

  /**
   * Оверлей — защита на честность: класс с размытием снимается из инструментов
   * разработчика в один клик, и помешать этому со статики нельзя. Зато можно
   * зафиксировать сам факт и показать организатору.
   */
  const markPeeked = useCallback(() => {
    if (gameOpenRef.current) return;
    setParticipant((prev) => (prev.peeked ? prev : { ...prev, peeked: true }));
  }, []);

  useEffect(() => {
    if (gameOpen) return;
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
      // При старте игры React сам убирает размытие и заглушку — это не подглядывание.
      if (gameOpenRef.current) return;
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
  }, [gameOpen, markPeeked]);

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
      // Сервер возвращает состояние игры — узнаём о старте и финише без лишнего запроса.
      if (result.round) setGame(result.round);
      // И собственные строки участника со стороны сервера: находки, которых нет
      // локально (список не пустеет в другом браузере и после очистки данных), плюс
      // вердикты организатора — но только после финиша. Пока игра идёт, вердиктов у
      // клиента нет вовсе: иначе их было бы видно в хранилище браузера.
      if (result.verdicts?.length) {
        const finished = result.round?.status === 'finished';
        const hide = (v: BugReport): BugReport =>
          finished ? v : { ...v, status: 'pending', score: 0, reviewComment: '' };
        const fromServer = result.verdicts
          .filter((v) => v && v.id && v.login === login)
          .map(hide);
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
          ? `Сервер не принял дефектов: ${result.rejected.length} (заведены вне игры)`
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

  // На финише забираем вердикты сразу: иначе в итогах до следующего цикла
  // синхронизации все находки висели бы «на проверке».
  useEffect(() => {
    if (game.status !== 'finished') return;
    void sync(true);
  }, [game.status, sync]);

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

  function addReport(title: string) {
    // Страховка на случай, если игра завершилась между отрисовкой и нажатием.
    if (!gameOpen) {
      setQuickError(lockReason || 'Приём дефектов закрыт');
      return;
    }
    const stamp = new Date().toISOString();
    const report: BugReport = {
      id: newId(),
      round: game.number,
      login,
      title,
      ...REPORT_DEFAULTS,
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

  /** Правка формулировки: меняется только текст находки, время остаётся прежним. */
  function saveTitle(title: string) {
    if (!editing) return;
    const stamp = new Date().toISOString();
    setReports((prev) =>
      prev.map((r) => (r.id === editing.id ? { ...r, title, updatedAt: stamp } : r)),
    );
    setEditing(null);
    setTimeout(() => void sync(true), 0);
  }

  /** Заведение находки одной строкой — единственный способ завести дефект. */
  function quickAdd() {
    const title = quickTitle.trim();
    if (title.length < 5) {
      setQuickError('Опишите проблему хотя бы парой слов');
      return;
    }
    setQuickError('');
    addReport(title);
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
    latest.current = { participant: finished, reports: gameReports };
    setFinishOpen(true);
    void sync(false);
  }

  /** Участник видит и сдаёт только находки текущего запуска игры. */
  const gameReports = useMemo(
    () => reports.filter((r) => r.round === game.number),
    [reports, game.number],
  );

  latest.current = { participant, reports: gameReports };

  const stats = useMemo(() => ({ total: gameReports.length }), [gameReports]);

  /**
   * Итоги показываем вместо витрины: игра уже завершена, магазин под размытием никому
   * не нужен, а личный результат — то, ради чего участник возвращается на страницу.
   */
  const showResults = results !== null && results.round === game.number && game.number > 0;

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
                gameOpen
                  ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                  : 'border-rose-200 bg-rose-100 text-rose-800',
              )}
              title={game.title || 'Состояние игры'}
              data-testid="game-status"
            >
              {gameOpen ? <Clock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {game.status === 'idle'
                ? 'игра не началась'
                : !gameOpen
                  ? 'приём закрыт'
                  : `идёт игра · ${formatDuration(remainingSec === null ? elapsedSec : remainingSec)}`}
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
              disabled={!gameOpen}
              data-testid="finish-game"
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
                  gameOpen
                    ? 'Что сломалось? Опишите одной строкой и нажмите Enter'
                    : 'Приём дефектов закрыт'
                }
                disabled={!gameOpen}
                value={quickTitle}
                onChange={(e) => {
                  setQuickTitle(e.target.value);
                  if (quickError) setQuickError('');
                }}
                data-testid="quick-title"
              />
            </div>

            <Button type="submit" size="md" disabled={!gameOpen} data-testid="quick-add">
              <Plus className="h-4 w-4" />
              Добавить
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
        {!gameOpen && !showResults && (
          <div className="mb-4">
            <Alert tone={game.status === 'idle' ? 'info' : 'error'}>
              <span className="font-medium">{GAME_STATUS_LABELS[game.status]}.</span> {lockReason}
              {gameReports.length > 0 && ` Заведено дефектов: ${gameReports.length}.`}
            </Alert>
          </div>
        )}
        {gameOpen && game.title && (
          <div className="mb-4">
            <Alert tone="success">
              Идёт игра: {game.title}
            </Alert>
          </div>
        )}

        {showResults ? (
          <GameResults results={results} login={login} reports={gameReports} />
        ) : (
        <div className="relative" ref={storeRef}>
          {/*
            Пока игра не идёт, витрина закрыта: иначе тот, кто вошёл раньше, успел бы
            изучить магазин заранее. Компонент не размонтируем — так состояние корзины
            не мигает при открытии, а сам старт для всех наступает одновременно.
          */}
          <div
            className={cn(!gameOpen && 'pointer-events-none select-none blur-[14px]')}
            aria-hidden={!gameOpen}
          >
            <ShoppingCartApp preview={!gameOpen} />
          </div>

          {!gameOpen && (
            <div
              className="absolute inset-0 z-20 flex items-start justify-center rounded-2xl bg-slate-900/60 p-6 backdrop-blur-md"
              data-testid="store-overlay"
            >
              <div className="mt-16 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl">
                <span
                  className={cn(
                    'mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl',
                    game.status === 'idle'
                      ? 'bg-orange-100 text-orange-600'
                      : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {game.status === 'idle' ? (
                    <Hourglass className="h-7 w-7" />
                  ) : (
                    <Lock className="h-7 w-7" />
                  )}
                </span>

                <h2 className="text-lg font-semibold">
                  {game.status === 'idle'
                    ? 'Магазин откроется со стартом игры'
                    : participant.finishedAt
                      ? 'Вы сдали результат'
                      : 'Игра завершена'}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {game.status === 'idle'
                    ? 'Вы в игре — ждём остальных. Витрина закрыта, чтобы никто не изучил её заранее: у всех будет одинаковое время.'
                    : lockReason}
                </p>

                {game.status === 'idle' && (
                  <p className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">
                    <Spinner className="h-4 w-4" />
                    Откроется автоматически, обновлять страницу не нужно
                  </p>
                )}

                {gameReports.length > 0 && (
                  <p className="mt-3 text-sm text-slate-600">
                    Ваших находок: <b>{gameReports.length}</b> — их видно по кнопке
                    «Мои дефекты».
                  </p>
                )}

                <p className="mt-4 text-xs text-slate-400">
                  Вы вошли как {login}
                </p>
              </div>
            </div>
          )}
        </div>
        )}
      </main>

      <BugListModal
        canEdit={gameOpen}
        open={listOpen}
        onClose={() => setListOpen(false)}
        reports={gameReports}
        stats={stats}
        onEdit={(r) => {
          setListOpen(false);
          setEditing(r);
        }}
        onDelete={deleteReport}
      />

      <EditTitleModal
        report={editing}
        onClose={() => setEditing(null)}
        onSave={saveTitle}
      />

      <FinishModal
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        participant={participant}
        reports={gameReports}
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
  /** Правки разрешены только пока игра идёт: после финиша список только для чтения. */
  canEdit: boolean;
  open: boolean;
  onClose: () => void;
  reports: BugReport[];
  stats: { total: number };
  onEdit: (r: BugReport) => void;
  onDelete: (id: string) => void;
}> = ({ canEdit, open, onClose, reports, stats, onEdit, onDelete }) => (
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
          Заведено находок: {stats.total}. Что засчитано и сколько принесло баллов — будет
          видно в итогах, когда организатор закончит проверку.
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
                /* Причину не уточняем: она выдала бы, что находку уже разобрали. */
                <span className="mt-1 text-slate-400" title="Эту находку изменить нельзя">
                  <Lock className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            {/*
              Статус, баллы и комментарий валидатора участнику по ходу игры не
              показываем: разбор идёт параллельно, и «принят / отклонён» в реальном
              времени превращает игру в подсказку, что искать дальше.
            */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge className="gap-1">
                <Clock className="h-3 w-3" />
                {formatDuration(r.elapsedSec)}
              </Badge>
            </div>
          </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-3">
        {canEdit && (
          <p className="mr-auto text-sm text-slate-500">
            Новую находку заводите строкой в шапке страницы.
          </p>
        )}
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </div>
  </Modal>
);

/**
 * Правка формулировки уже заведённой находки. Полей ровно столько же, сколько при
 * заведении, — одно: расписывать дефект подробно в конкурсе не требуется.
 */
const EditTitleModal: React.FC<{
  report: BugReport | null;
  onClose: () => void;
  onSave: (title: string) => void;
}> = ({ report, onClose, onSave }) => {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!report) return;
    setTitle(report.title);
    setError('');
  }, [report]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = title.trim();
    if (value.length < 5) return setError('Опишите проблему хотя бы парой слов');
    onSave(value);
  }

  return (
    <Modal open={report !== null} onClose={onClose} title="Изменить формулировку">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Что сломалось</label>
          <input
            className="field"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError('');
            }}
            placeholder="Кратко: что и где работает не так"
            autoFocus
            data-testid="bug-title"
          />
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
    <Modal open={open} onClose={onClose} title="Результат сдан">
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Заведено дефектов: <b>{reports.length}</b>. Вы искали:{' '}
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
