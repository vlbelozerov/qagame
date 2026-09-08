import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Copy,
  Download,
  Gamepad2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Upload,
  Eye,
  Play,
  PartyPopper,
  RotateCcw,
  Send,
  Square,
  Users,
  Wand2,
} from 'lucide-react';
import { config } from '@/config';
import { Alert, Badge, Button, Card, CardContent, Modal, Spinner, cn } from '@/components/ui';
import { storage } from '@/lib/storage';
import {
  decodeSnapshot,
  fetchReference,
  fetchSnapshot,
  finishGame as finishRoundRequest,
  isOnlineMode,
  publishResults,
  pushVerdict,
  resetCompetition,
  startGame as startRoundRequest,
} from '@/lib/sync';
import {
  AREA_LABELS,
  EMPTY_GAME,
  GAME_STATUS_LABELS,
  SEVERITY_LABELS,
  SEVERITY_POINTS,
  SEVERITY_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  type Area,
  type BugReport,
  type Participant,
  type GameState,
  type ValidationStatus,
} from '@/lib/types';
import type { KnownBug } from '@/lib/knownBugs';
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_STYLES,
  matchAll,
  type MatchConfidence,
  type MatchResult,
} from '@/lib/matcher';
import { mentionsHoneypot } from '@/lib/honeypot';
import {
  buildGameReport,
  reportToText,
  toPublishedResults,
  type GameReport,
} from '@/lib/gameReport';
import { formatDuration, plural } from '@/lib/format';

type Filter = 'all' | ValidationStatus;
type MatchFilter = 'any' | MatchConfidence | 'duplicate';

export const AdminPage: React.FC<{
  /** Логин, под которым организатор вошёл, — им же авторизуем запросы к серверу. */
  adminName: string;
  adminSecret: string;
  onLogout: () => void;
  /** Задан только в демо-режиме: возврат к экрану участника. */
  onSwitchRole?: () => void;
}> = ({ adminName, adminSecret, onLogout, onSwitchRole }) => {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // По умолчанию показываем очередь разбора: только неразобранные дефекты всех
  // участников сразу. После вердикта карточка уходит из списка сама.
  const [filter, setFilter] = useState<Filter>('pending');
  /** Последний одиночный вердикт — чтобы можно было вернуть карточку, если ошиблись. */
  const [lastVerdict, setLastVerdict] = useState<BugReport | null>(null);
  const [selectedLogin, setSelectedLogin] = useState<string>('');
  const [importOpen, setImportOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [knownBugs, setKnownBugs] = useState<KnownBug[]>([]);
  const [knownBugsError, setKnownBugsError] = useState('');
  const [matches, setMatches] = useState<Map<string, MatchResult>>(new Map());
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('any');
  const [analyzing, setAnalyzing] = useState(false);
  const [autoNote, setAutoNote] = useState('');
  const [game, setGame] = useState<GameState>(() =>
    isOnlineMode() ? EMPTY_GAME : storage.getGame(),
  );
  const [gameTitle, setRoundTitle] = useState('');
  const [gameMinutes, setRoundMinutes] = useState(config.gameMinutes);
  const [gameBusy, setRoundBusy] = useState(false);
  const [runFilter, setRoundFilter] = useState<number | 'all'>('all');
  const [report, setReport] = useState<GameReport | null>(null);
  const [reportCopied, setReportCopied] = useState(false);
  /** Публикация итогов участникам: пусто — ещё не публиковали в этот заход. */
  const [publishState, setPublishState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [publishError, setPublishError] = useState('');

  const load = useCallback(async () => {
    if (!isOnlineMode()) {
      // Офлайн: показываем ранее импортированные результаты и состояние игры участника,
      // который играет в этом же браузере, — так админку видно без обмена кодами.
      const saved = storage.getAdminData();
      const localPlayer = storage.getParticipant();
      const localReports = localPlayer
        ? storage.getReports().filter((r) => r.login === localPlayer.login)
        : [];
      setParticipants(
        localPlayer
          ? [...saved.participants.filter((p) => p.login !== localPlayer.login), localPlayer]
          : saved.participants,
      );
      // Вердикты, проставленные админом, приоритетнее данных из localStorage участника.
      const verdicts = new Map(saved.reports.map((r) => [r.id, r]));
      const merged = localReports.map((r) => {
        const verdict = verdicts.get(r.id);
        return verdict
          ? { ...r, status: verdict.status, score: verdict.score, reviewComment: verdict.reviewComment }
          : r;
      });
      const localIds = new Set(localReports.map((r) => r.id));
      setReports([...saved.reports.filter((r) => !localIds.has(r.id)), ...merged]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const snapshot = await fetchSnapshot(adminName, adminSecret);
      setParticipants(snapshot.participants);
      setReports(snapshot.reports);
      setGame(snapshot.round);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, [adminName, adminSecret]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Список запрашиваем сразу после входа, не дожидаясь «Авторазбора»: если в проекте
   * Apps Script нет Reference.gs или развёртывание старое, организатор должен узнать
   * об этом при входе, а не в разгар разбора.
   */
  useEffect(() => {
    if (!isOnlineMode()) return;
    fetchReference(adminName, adminSecret)
      .then((list) => {
        // Форму ответа проверяем: без Reference.gs сервер может вернуть что угодно,
        // и админка не должна из-за этого падать в белый экран.
        if (Array.isArray(list)) {
          setKnownBugs(list);
          setKnownBugsError('');
          return;
        }
        setKnownBugsError(
          'Сервер вернул не эталонный список: проверьте, что в проект Apps Script добавлен ' +
            'файл Reference.gs, и создайте новое развёртывание.',
        );
      })
      .catch((err: unknown) =>
        setKnownBugsError(err instanceof Error ? err.message : 'Эталонный список недоступен'),
      );
  }, [adminName, adminSecret]);

  // В офлайн-режиме сводка живёт в localStorage, иначе вердикты терялись бы при перезагрузке.
  useEffect(() => {
    if (isOnlineMode()) return;
    if (participants.length === 0 && reports.length === 0) return;
    storage.setAdminData({ participants, reports });
  }, [participants, reports]);

  /**
   * Управление игрой. В онлайне состояние живёт в таблице и доходит до всех участников;
   * в офлайне пишем в localStorage — оно действует только в этом браузере.
   */
  async function applyGame(action: 'start' | 'finish' | 'reset') {
    setRoundBusy(true);
    setError('');
    try {
      if (isOnlineMode()) {
        const next =
          action === 'start'
            ? await startRoundRequest(adminName, adminSecret, {
                title: gameTitle.trim(),
                durationMinutes: gameMinutes,
              })
            : action === 'finish'
              ? await finishRoundRequest(adminName, adminSecret)
              : await resetCompetition(adminName, adminSecret);
        setGame(next);
        if (action === 'reset') {
          setParticipants([]);
          setReports([]);
          setMatches(new Map());
        }
        await load();
      } else {
        const now = new Date();
        if (action === 'start') {
          const next: GameState = {
            number: game.number + 1,
            status: 'running',
            title: gameTitle.trim(),
            startedAt: now.toISOString(),
            endsAt:
              gameMinutes > 0
                ? new Date(now.getTime() + gameMinutes * 60_000).toISOString()
                : '',
            finishedAt: '',
          };
          storage.setGame(next);
          setGame(next);
        } else if (action === 'finish') {
          const next: GameState = { ...game, status: 'finished', finishedAt: now.toISOString() };
          storage.setGame(next);
          setGame(next);
        } else {
          storage.clearAll();
          storage.setGame(EMPTY_GAME);
          setGame(EMPTY_GAME);
          setParticipants([]);
          setReports([]);
          setMatches(new Map());
        }
      }
      setRoundTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить состояние игры');
    } finally {
      setRoundBusy(false);
    }
  }

  /** Итоги игры: номинации считаются по принятым дефектам текущего разбора. */
  async function openReport() {
    // Без эталонного списка отчёт всё равно нужен: места, баллы и номинации по
    // участникам считаются и без него — не хватит только покрытия и названий дефектов.
    const bugs = await tryLoadKnownBugs();
    let current = matches;
    // Без разбора не с чем сопоставлять находки — запускаем его молча.
    if (current.size === 0) {
      current = matchAll(reports, bugs);
      setMatches(current);
    }
    const target = runFilter === 'all' ? game.number || 1 : runFilter;
    setReport(buildGameReport(target, reports, current, bugs, participants));
    setReportCopied(false);
    setPublishState('idle');
    setPublishError('');
  }

  /**
   * Публикация итогов участникам. Считаем здесь, потому что эталонный список есть
   * только в админке; сервер хранит готовый результат и раздаёт его одним запросом.
   */
  async function publish() {
    if (!report) return;
    setPublishState('busy');
    setPublishError('');
    try {
      const payload = toPublishedResults(report, game);
      if (isOnlineMode()) await publishResults(adminName, adminSecret, payload);
      else storage.setResults(payload);
      setPublishState('done');
    } catch (err) {
      setPublishState('error');
      setPublishError(err instanceof Error ? err.message : 'Не удалось опубликовать итоги');
    }
  }

  function confirmReset() {
    const ok = window.confirm(
      'Начать новый конкурс? Все участники, дефекты и вердикты будут удалены безвозвратно, а игра вернётся в состояние «не началась».',
    );
    if (ok) void applyGame('reset');
  }

  /**
   * Эталонный список приходит с сервера по паролю организатора. В бандл он не
   * включён намеренно: сборку страницы может открыть любой участник.
   */
  async function loadKnownBugs(): Promise<KnownBug[]> {
    if (knownBugs.length > 0) return knownBugs;
    if (!isOnlineMode()) {
      throw new Error(
        'Эталонный список хранится в проекте Apps Script и доступен только по паролю ' +
          'организатора. В офлайн-режиме (без syncEndpoint) авторазбор и выбор дефекта ' +
          'недоступны — вердикты и баллы проставляются вручную.',
      );
    }
    const list = await fetchReference(adminName, adminSecret);
    if (!Array.isArray(list)) {
      throw new Error(
        'Сервер вернул не эталонный список. Проверьте, что в проекте Apps Script есть ' +
          'файл Reference.gs, и создайте новое развёртывание.',
      );
    }
    setKnownBugs(list);
    return list;
  }

  /**
   * Список, если он доступен. Ошибку не бросаем, а показываем плашкой в шапке:
   * из-за недоступного списка не должны ломаться экраны, которые без него работают.
   */
  async function tryLoadKnownBugs(): Promise<KnownBug[]> {
    try {
      return await loadKnownBugs();
    } catch (err) {
      setKnownBugsError(err instanceof Error ? err.message : 'Эталонный список недоступен');
      return [];
    }
  }

  async function openReference() {
    // Окно открываем сразу: если чанк со списком не загрузится, пользователь должен
    // увидеть причину, а не молча ничего не получить по нажатию.
    setReferenceOpen(true);
    setKnownBugsError('');
    try {
      await loadKnownBugs();
    } catch (err) {
      setKnownBugsError(
        err instanceof Error ? err.message : 'Не удалось загрузить эталонный список.',
      );
    }
  }

  /** Сопоставляет все репорты с эталонным списком по ключевым словам. */
  async function runAnalysis() {
    setAnalyzing(true);
    setAutoNote('');
    try {
      const bugs = await loadKnownBugs();
      setMatches(matchAll(reports, bugs));
      setKnownBugsError('');
    } catch (err) {
      // Списка может не быть: офлайн-режим, старое развёртывание или в проекте
      // Apps Script не добавлен Reference.gs.
      setKnownBugsError(err instanceof Error ? err.message : 'Эталонный список недоступен');
    } finally {
      setAnalyzing(false);
    }
  }

  /** Пакетная простановка вердиктов: одно обновление состояния, затем отправка на сервер. */
  async function applyVerdicts(patches: { report: BugReport; patch: Partial<BugReport> }[]) {
    if (patches.length === 0) return;
    const stamp = new Date().toISOString();
    const byId = new Map(patches.map((p) => [p.report.id, { ...p.report, ...p.patch, updatedAt: stamp }]));
    setReports((prev) => prev.map((r) => byId.get(r.id) ?? r));

    if (!isOnlineMode()) return;
    for (const updated of byId.values()) {
      try {
        await pushVerdict(adminName, adminSecret, {
          id: updated.id,
          status: updated.status,
          score: updated.score,
          reviewComment: updated.reviewComment,
          bugCode: updated.bugCode ?? '',
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Часть вердиктов не сохранилась на сервере');
        return;
      }
    }
  }

  /** Принимает уверенно распознанные находки; баллы берутся по серьёзности эталонного дефекта. */
  async function acceptConfident() {
    const bugByCode = new Map(knownBugs.map((b) => [b.code, b]));
    const patches = reports
      .filter((r) => r.status === 'pending')
      .map((r) => ({ report: r, match: matches.get(r.id) }))
      .filter((x) => x.match?.confidence === 'high' && !x.match.duplicate)
      .map(({ report, match }) => {
        const bug = bugByCode.get(match!.code);
        return {
          report,
          patch: {
            status: 'accepted' as const,
            score: bug ? SEVERITY_POINTS[bug.severity] : SEVERITY_POINTS.minor,
            reviewComment: `Авторазбор: ${match!.code}`,
            bugCode: match!.code,
          },
        };
      });
    await applyVerdicts(patches);
    setAutoNote(`Принято автоматически: ${patches.length}`);
  }

  /** Помечает повторные находки одного участника по тому же дефекту. */
  async function markDuplicates() {
    const patches = reports
      .filter((r) => r.status === 'pending')
      .map((r) => ({ report: r, match: matches.get(r.id) }))
      .filter((x) => x.match?.confidence === 'high' && x.match.duplicate)
      .map(({ report, match }) => ({
        report,
        patch: {
          status: 'duplicate' as const,
          score: 0,
          reviewComment: `Авторазбор: повтор ${match!.code}`,
          bugCode: match!.code,
        },
      }));
    await applyVerdicts(patches);
    setAutoNote(`Помечено дубликатов: ${patches.length}`);
  }

  async function setVerdict(report: BugReport, patch: Partial<BugReport>) {
    // Меняется статус — карточка исчезнет из очереди, поэтому запоминаем прежнее
    // состояние: вернуть его одним нажатием проще, чем искать в других фильтрах.
    if (patch.status && patch.status !== report.status) setLastVerdict(report);
    const updated = { ...report, ...patch, updatedAt: new Date().toISOString() };
    setReports((prev) => prev.map((r) => (r.id === report.id ? updated : r)));
    if (!isOnlineMode()) return;
    try {
      await pushVerdict(adminName, adminSecret, {
        id: updated.id,
        status: updated.status,
        score: updated.score,
        reviewComment: updated.reviewComment,
        bugCode: updated.bugCode ?? '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Вердикт не сохранён на сервере');
    }
  }

  function importCode(code: string) {
    const { participant, reports: imported } = decodeSnapshot(code);
    setParticipants((prev) => [...prev.filter((p) => p.login !== participant.login), participant]);
    setReports((prev) => [
      ...prev.filter((r) => r.login !== participant.login),
      ...imported.map((r) => ({ ...r, login: participant.login })),
    ]);
  }

  const leaderboard = useMemo(() => {
    const byLogin = new Map<
      string,
      { login: string; total: number; accepted: number; score: number; participant?: Participant }
    >();
    participants.forEach((p) =>
      byLogin.set(p.login, { login: p.login, total: 0, accepted: 0, score: 0, participant: p }),
    );
    reports.forEach((r) => {
      const row = byLogin.get(r.login) ?? { login: r.login, total: 0, accepted: 0, score: 0 };
      row.total += 1;
      if (r.status === 'accepted') {
        row.accepted += 1;
        row.score += r.score;
      }
      byLogin.set(r.login, row);
    });
    return [...byLogin.values()].sort(
      (a, b) => b.score - a.score || b.accepted - a.accepted || a.login.localeCompare(b.login),
    );
  }, [participants, reports]);

  const visibleReports = useMemo(
    () =>
      reports
        .filter((r) => (filter === 'all' ? true : r.status === filter))
        .filter((r) => (selectedLogin ? r.login === selectedLogin : true))
        .filter((r) => (runFilter === 'all' ? true : (r.round ?? 0) === runFilter))
        .filter((r) => {
          if (matchFilter === 'any') return true;
          const m = matches.get(r.id);
          if (matchFilter === 'duplicate') return Boolean(m?.duplicate);
          return (m?.confidence ?? 'none') === matchFilter;
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [reports, filter, selectedLogin, matchFilter, matches, runFilter],
  );

  const bugByCode = useMemo(() => new Map(knownBugs.map((b) => [b.code, b])), [knownBugs]);

  /**
   * Код дефекта, на который засчитана находка. Проставленный организатором имеет
   * приоритет: покрытие и итоги должны отражать разбор, а не догадку автомата.
   */
  const codeOf = useCallback(
    (r: BugReport) => r.bugCode || matches.get(r.id)?.code || '',
    [matches],
  );

  const pendingCount = useMemo(
    () => reports.filter((r) => r.status === 'pending').length,
    [reports],
  );

  const availableRuns = useMemo(
    () => [...new Set(reports.map((r) => r.round ?? 0))].sort((a, b) => a - b),
    [reports],
  );

  /** Сводка авторазбора и покрытие эталонного списка. */
  const analysis = useMemo(() => {
    // Покрытие есть и без авторазбора: коды могли быть проставлены руками.
    if (matches.size === 0 && !reports.some((r) => r.bugCode)) return null;
    const pending = reports.filter((r) => r.status === 'pending');
    const counts = { high: 0, low: 0, none: 0, duplicates: 0 };
    const foundCodes = new Map<string, Set<string>>();
    reports.forEach((r) => {
      // Отклонённое не считается находкой, а вот принятое вручную — считается,
      // даже если авторазбор его не распознал.
      if (r.status === 'rejected') return;
      const code = r.bugCode || matches.get(r.id)?.code || '';
      if (!code) return;
      const who = foundCodes.get(code) ?? new Set<string>();
      who.add(r.login);
      foundCodes.set(code, who);
    });
    pending.forEach((r) => {
      const m = matches.get(r.id);
      if (!m) return;
      if (m.confidence === 'high' && m.duplicate) counts.duplicates += 1;
      else counts[m.confidence] += 1;
    });
    return { counts, foundCodes };
  }, [matches, reports]);

  function exportCsv() {
    const header = [
      'Логин',
      'Заголовок',
      'Код дефекта',
      'Код авторазбора',
      'Время от старта',
      'Создан',
      'Статус',
      'Баллы',
      'Комментарий',
    ];
    const rows = reports.map((r) => [
      r.login,
      r.title,
      r.bugCode ?? '',
      matches.get(r.id)?.code ?? '',
      formatDuration(r.elapsedSec),
      new Date(r.createdAt).toLocaleString('ru-RU'),
      STATUS_LABELS[r.status],
      String(r.score),
      r.reviewComment,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    // BOM, чтобы Excel открыл кириллицу без плясок с кодировкой.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qagame-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Админка конкурса</p>
            <p className="text-xs text-slate-500">
              {isOnlineMode()
                ? 'Данные с сервера конкурса'
                : 'Офлайн-режим: игра в этом браузере и импортированные коды'}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void runAnalysis()}
              disabled={analyzing || reports.length === 0}
              data-testid="run-analysis"
            >
              {analyzing ? <Spinner /> : <Wand2 className="h-4 w-4" />}
              Авторазбор
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void openReport()}
              disabled={reports.length === 0}
              data-testid="open-report"
            >
              <PartyPopper className="h-4 w-4" />
              Итоги игры
            </Button>
            <Button size="sm" variant="secondary" onClick={openReference}>
              <BookOpen className="h-4 w-4" />
              Эталонный список
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" />
              Импорт кода
            </Button>
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={reports.length === 0}>
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
              Обновить
            </Button>
            {onSwitchRole && (
              <Button size="sm" variant="secondary" onClick={onSwitchRole} data-testid="go-player">
                <Gamepad2 className="h-4 w-4" />
                К участнику
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onLogout} aria-label="Выйти">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {error && <Alert tone="error">{error}</Alert>}

        {knownBugsError && (
          <Alert tone="error">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <span>
                <span className="font-medium">Эталонный список не загружен.</span>{' '}
                {knownBugsError} Разбор работать будет, но без авторазбора и выбора дефекта:
                статусы и баллы придётся проставлять вручную.
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void tryLoadKnownBugs()}
                data-testid="retry-reference"
              >
                <RefreshCw className="h-4 w-4" />
                Повторить
              </Button>
            </div>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Участников" value={leaderboard.length} />
          <Stat label="Всего дефектов" value={reports.length} />
          <Stat label="Подтверждено" value={reports.filter((r) => r.status === 'accepted').length} />
          <Stat label="На проверке" value={pendingCount} />
        </div>


        <Card className={cn(game.status === 'running' && 'border-emerald-300')}>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">Управление игрой</h3>
              <Badge
                className={cn(
                  game.status === 'running'
                    ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                    : game.status === 'finished'
                      ? 'border-rose-200 bg-rose-100 text-rose-800'
                      : '',
                )}
                data-testid="admin-game-status"
              >
                {GAME_STATUS_LABELS[game.status]}
                {/* Номер запуска нужен только после перезапуска: игра-то одна. */}
                {game.number > 1 && ` · запуск ${game.number}`}
              </Badge>
              {game.title && <span className="text-sm text-slate-500">{game.title}</span>}
            </div>

            {game.status !== 'running' ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <label className="label">Название игры — необязательно</label>
                  <input
                    className="field"
                    value={gameTitle}
                    onChange={(e) => setRoundTitle(e.target.value)}
                    placeholder="Например: Финал, поток 2"
                    data-testid="game-title"
                  />
                </div>
                <div>
                  <label className="label">Минут (0 — без таймера)</label>
                  <input
                    type="number"
                    min={0}
                    className="field w-32"
                    value={gameMinutes}
                    onChange={(e) => setRoundMinutes(Math.max(0, Number(e.target.value) || 0))}
                    data-testid="game-minutes"
                  />
                </div>
                <Button onClick={() => void applyGame('start')} disabled={gameBusy} data-testid="start-game">
                  {gameBusy ? <Spinner /> : <Play className="h-4 w-4" />}
                  {game.number === 0 ? 'Начать игру' : 'Начать заново'}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-slate-600">
                  Начат в {new Date(game.startedAt).toLocaleTimeString('ru-RU')}
                  {game.endsAt
                    ? ` · автозавершение в ${new Date(game.endsAt).toLocaleTimeString('ru-RU')}`
                    : ' · без таймера, закроется вручную'}
                  .
                </p>
                <Button
                  variant="danger"
                  onClick={() => void applyGame('finish')}
                  disabled={gameBusy}
                  data-testid="finish-game-admin"
                >
                  {gameBusy ? <Spinner /> : <Square className="h-4 w-4" />}
                  Завершить игру
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <Button variant="secondary" size="sm" onClick={confirmReset} disabled={gameBusy} data-testid="reset-competition">
                <RotateCcw className="h-4 w-4" />
                Новый конкурс — удалить все данные
              </Button>
              <span className="text-xs text-slate-500">
                {isOnlineMode()
                  ? 'Состояние игры общее: участники увидят изменение в течение 10 секунд.'
                  : 'Офлайн-режим: игра управляется только в этом браузере — у других участников состояние своё.'}
              </span>
            </div>
          </CardContent>
        </Card>

        {analysis && (
          <Card className="border-orange-200 bg-orange-50/60">
            <CardContent className="space-y-3">
              <h3 className="flex items-center gap-2 font-semibold">
                <Wand2 className="h-4 w-4" />
                Авторазбор по ключевым словам
              </h3>
              <p className="text-sm text-slate-600">
                Из репортов «на проверке»: <b>{analysis.counts.high}</b> распознано уверенно,{' '}
                <b>{analysis.counts.duplicates}</b> повторов у тех же участников,{' '}
                <b>{analysis.counts.low}</b> требуют взгляда, <b>{analysis.counts.none}</b> не
                распознаны. Автомат ничего не отклоняет — спорное остаётся вам.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => void acceptConfident()}
                  disabled={analysis.counts.high === 0}
                  data-testid="accept-confident"
                >
                  Принять уверенные ({analysis.counts.high})
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void markDuplicates()}
                  disabled={analysis.counts.duplicates === 0}
                  data-testid="mark-duplicates"
                >
                  <Copy className="h-4 w-4" />
                  Пометить дубликаты ({analysis.counts.duplicates})
                </Button>
                <Button size="sm" variant="secondary" onClick={openReference}>
                  Покрытие: {analysis.foundCodes.size} из {knownBugs.length}
                </Button>
              </div>
              {autoNote && <Alert tone="success">{autoNote}</Alert>}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-3">
            <h3 className="flex items-center gap-2 font-semibold">
              <Users className="h-4 w-4" />
              Итоги по участникам
            </h3>
            {leaderboard.length === 0 && (
              <p className="text-sm text-slate-500">
                Данных пока нет.{' '}
                {isOnlineMode()
                  ? 'Нажмите «Обновить», когда участники начнут работу.'
                  : 'Заведите дефект на экране участника или импортируйте коды результатов.'}
              </p>
            )}
            {leaderboard.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2">#</th>
                      <th>Логин</th>
                      <th>Дефектов</th>
                      <th>Принято</th>
                      <th>Баллы</th>
                      <th>Старт</th>
                      <th>Длительность</th>
                      <th>Статус</th>
                      <th>Честность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((row, i) => {
                      const p = row.participant;
                      const durationSec = p
                        ? Math.floor(
                            (new Date(p.finishedAt || p.lastSeenAt).getTime() -
                              new Date(p.startedAt).getTime()) /
                              1000,
                          )
                        : 0;
                      return (
                        <tr
                          key={row.login}
                          className={cn(
                            'cursor-pointer border-t border-slate-100 hover:bg-slate-50',
                            selectedLogin === row.login && 'bg-orange-50',
                          )}
                          onClick={() =>
                            setSelectedLogin(selectedLogin === row.login ? '' : row.login)
                          }
                        >
                          <td className="py-2 text-slate-400">{i + 1}</td>
                          <td className="font-medium">{row.login}</td>
                          <td>{row.total}</td>
                          <td>{row.accepted}</td>
                          <td className="font-semibold">{row.score}</td>
                          <td className="text-slate-500">
                            {p ? new Date(p.startedAt).toLocaleTimeString('ru-RU') : '—'}
                          </td>
                          <td className="text-slate-500">
                            {p ? formatDuration(durationSec) : '—'}
                          </td>
                          <td>
                            {p?.finishedAt ? (
                              <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">
                                завершил
                              </Badge>
                            ) : (
                              <Badge>в игре</Badge>
                            )}
                          </td>
                          <td>
                            {p?.peeked ? (
                              <Badge
                                className="gap-1 border-amber-200 bg-amber-100 text-amber-800"
                                title="Витрину открывали до старта игры: снят оверлей или были клики сквозь него"
                                data-testid={`peeked-${row.login}`}
                              >
                                <Eye className="h-3 w-3" />
                                заглядывал
                              </Badge>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {selectedLogin && (
              <p className="text-sm text-slate-500">
                Показаны дефекты участника <b>{selectedLogin}</b>.{' '}
                <button className="underline" onClick={() => setSelectedLogin('')}>
                  Сбросить фильтр
                </button>
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="font-semibold">
            {filter === 'pending' ? 'Очередь разбора' : 'Дефекты'}
          </h3>
          <span className="text-sm text-slate-500">
            разобрано {reports.filter((r) => r.status !== 'pending').length} из {reports.length}
            {selectedLogin ? ` · показан только ${selectedLogin}` : ' · все участники'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'pending', 'accepted', 'rejected', 'duplicate'] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}>
              <Badge
                className={cn(
                  filter === f && 'border-slate-900 bg-slate-900 text-white',
                )}
              >
                {f === 'all' ? 'Все' : STATUS_LABELS[f]}
              </Badge>
            </button>
          ))}
          {availableRuns.length > 1 && (
            <>
              <span className="mx-1 h-4 w-px bg-slate-300" />
              <select
                className="field w-auto py-1 text-xs"
                value={String(runFilter)}
                onChange={(e) =>
                  setRoundFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                }
                data-testid="game-filter"
              >
                <option value="all">Все запуски</option>
                {availableRuns.map((n) => (
                  <option key={n} value={n}>
                    Запуск {n}
                  </option>
                ))}
              </select>
            </>
          )}
          {analysis && (
            <>
              <span className="mx-1 h-4 w-px bg-slate-300" />
              {(['any', 'high', 'low', 'none', 'duplicate'] as MatchFilter[]).map((f) => (
                <button key={f} onClick={() => setMatchFilter(f)} data-testid={`match-filter-${f}`}>
                  <Badge className={cn(matchFilter === f && 'border-slate-900 bg-slate-900 text-white')}>
                    {f === 'any'
                      ? 'Любой разбор'
                      : f === 'duplicate'
                        ? 'повторы'
                        : CONFIDENCE_LABELS[f]}
                  </Badge>
                </button>
              ))}
            </>
          )}
          <span className="text-sm text-slate-500">найдено: {visibleReports.length}</span>
        </div>

        {lastVerdict && (
          <Alert tone="info">
            <span className="flex flex-wrap items-center gap-2">
              Разобрано: «{lastVerdict.title}» — карточка убрана из очереди.
              <button
                className="font-medium underline"
                onClick={() => {
                  void setVerdict(lastVerdict, {
                    status: 'pending',
                    score: 0,
                    reviewComment: '',
                  });
                  setLastVerdict(null);
                }}
                data-testid="undo-verdict"
              >
                Вернуть на проверку
              </button>
            </span>
          </Alert>
        )}

        {filter === 'pending' && visibleReports.length === 0 && reports.length > 0 && (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="font-medium">Очередь разбора пуста</p>
              <p className="mt-1 text-sm text-slate-500">
                Все дефекты разобраны. Чтобы пересмотреть решения, переключите фильтр на
                «Принят», «Отклонён» или «Все».
              </p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {visibleReports.map((r) => (
            <ReportRow
              key={r.id}
              report={r}
              match={matches.get(r.id)}
              honeypot={mentionsHoneypot(`${r.title} ${r.steps} ${r.expected} ${r.actual}`)}
              knownBug={bugByCode.get(codeOf(r))}
              knownBugs={knownBugs}
              onVerdict={setVerdict}
            />
          ))}
        </div>
      </main>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={importCode}
      />

      <Modal
        open={report !== null}
        onClose={() => setReport(null)}
        title="Итоги игры"
        wide
      >
        {report && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Участников" value={report.participants} />
              <Stat label="Засчитано находок" value={report.accepted} />
              <Stat label="Найдено дефектов" value={report.foundBugs} />
            </div>

            {pendingCount > 0 && (
              <Alert tone="info">
                Ещё не разобрано: {pendingCount}. Номинации считаются только по подтверждённым
                находкам, поэтому итоги стоит смотреть после разбора.
              </Alert>
            )}

            {report.standings.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Место</th>
                      <th className="px-3 py-2">Участник</th>
                      <th className="px-3 py-2">Баллы</th>
                      <th className="px-3 py-2">Засчитано</th>
                      <th className="px-3 py-2">Заявок</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.standings.slice(0, 10).map((row) => (
                      <tr key={row.login} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-semibold">{row.place}</td>
                        <td className="px-3 py-1.5">{row.login}</td>
                        <td className="px-3 py-1.5 font-semibold">{row.score}</td>
                        <td className="px-3 py-1.5">{row.accepted}</td>
                        <td className="px-3 py-1.5 text-slate-500">{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.standings.length > 10 && (
                  <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                    Показаны первые 10 из {report.standings.length}. Участники видят полную
                    таблицу и своё место в ней.
                  </p>
                )}
              </div>
            )}

            {report.nominations.length === 0 ? (
              <Alert tone="info">
                Пока нет ни одной подтверждённой находки — номинации появятся после разбора.
              </Alert>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {report.nominations.map((n) => (
                  <div
                    key={n.key}
                    className="rounded-xl border border-slate-200 p-3"
                    data-testid={`nomination-${n.key}`}
                  >
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {n.emoji} {n.title}
                    </p>
                    <p className="font-semibold">{n.winner}</p>
                    <p className="text-sm text-slate-600">{n.detail}</p>
                  </div>
                ))}
              </div>
            )}

            {report.missed.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="font-medium">
                  Не нашёл никто: {report.missed.length} из {report.knownBugs}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                  {report.missed.map((bug) => (
                    <li key={bug.code}>
                      <span className="font-mono text-xs text-slate-500">{bug.code}</span>{' '}
                      {bug.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {publishState === 'done' && (
              <Alert tone="success">
                Итоги опубликованы: участники видят своё место, баллы, разбор своих находок
                и личные номинации. Повторная публикация перезапишет их — нажмите ещё раз,
                если после этого меняли вердикты.
              </Alert>
            )}
            {publishState === 'error' && <Alert tone="error">{publishError}</Alert>}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              <Button variant="secondary" onClick={() => setReport(null)}>
                Закрыть
              </Button>
              <Button
                variant="secondary"
                onClick={() => void publish()}
                disabled={publishState === 'busy'}
                data-testid="publish-results"
                title="Участники увидят личные итоги на своей странице"
              >
                {publishState === 'busy' ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {publishState === 'done' ? 'Опубликовать заново' : 'Опубликовать участникам'}
              </Button>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(reportToText(report));
                    setReportCopied(true);
                  } catch {
                    setReportCopied(false);
                  }
                }}
                data-testid="copy-report"
              >
                <Copy className="h-4 w-4" />
                {reportCopied ? 'Скопировано' : 'Скопировать для чата'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={referenceOpen}
        onClose={() => setReferenceOpen(false)}
        title="Эталонный список внесённых дефектов"
        wide
      >
        <div className="space-y-2">
          {knownBugsError && <Alert tone="error">{knownBugsError}</Alert>}
          {!knownBugsError && knownBugs.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner /> Загружаю список…
            </p>
          )}
          {knownBugs.length > 0 && (
            <p className="text-sm text-slate-500">
              Всего заложено дефектов: {knownBugs.length}. Список нужен только для валидации — не
              показывайте его участникам до конца игры.
            </p>
          )}
          {analysis && (
            <p className="text-sm text-slate-600">
              По итогам авторазбора найдено <b>{analysis.foundCodes.size}</b> из{' '}
              <b>{knownBugs.length}</b>. Ненайденные отмечены серым — это то, что участники
              пропустили.
            </p>
          )}
          {knownBugs.map((b) => {
            const finders = analysis?.foundCodes.get(b.code);
            return (
              <div
                key={b.code}
                className={cn(
                  'rounded-lg border p-3',
                  analysis && !finders ? 'border-slate-200 bg-slate-50' : 'border-slate-200',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="font-mono">{b.code}</Badge>
                  <Badge className={SEVERITY_STYLES[b.severity]}>
                    {SEVERITY_LABELS[b.severity]}
                  </Badge>
                  <Badge>{AREA_LABELS[b.area]}</Badge>
                  {analysis &&
                    (finders ? (
                      <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">
                        нашли: {finders.size}
                      </Badge>
                    ) : (
                      <Badge>никто не нашёл</Badge>
                    ))}
                </div>
                <p className="mt-1 font-medium">{b.title}</p>
                <p className="text-sm text-slate-500">{b.hint}</p>
                {finders && finders.size > 0 && (
                  <p className="mt-1 text-xs text-slate-500">{[...finders].join(', ')}</p>
                )}
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <Card>
    <CardContent className="py-3">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </CardContent>
  </Card>
);

const ReportRow: React.FC<{
  report: BugReport;
  /** Результат авторазбора, если он запускался. */
  match?: MatchResult;
  /** Эталонный дефект, на который засчитана находка, — его текст нужен для сверки глазами. */
  knownBug?: KnownBug;
  /** Весь эталонный список — из него организатор выбирает дефект вручную. */
  knownBugs: KnownBug[];
  /** Найденный в тексте маркер-приманка: такое видно только со снятым оверлеем. */
  honeypot?: string | null;
  onVerdict: (r: BugReport, patch: Partial<BugReport>) => void;
}> = ({ report, match, knownBug, knownBugs, honeypot, onVerdict }) => {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState(report.reviewComment);

  /** Что выбрано в списке: сохранённый код, иначе подсказка авторазбора. */
  const selectedCode = report.bugCode ?? match?.code ?? '';
  const selectedBug = knownBugs.find((b) => b.code === selectedCode);

  /**
   * Баллы предлагаются по серьёзности выбранного эталонного дефекта. Участник
   * серьёзность не указывает, поэтому без выбора значение проставляет валидатор.
   */
  const suggestedScore = selectedBug
    ? SEVERITY_POINTS[selectedBug.severity]
    : SEVERITY_POINTS.minor;

  /** Список для выбора: сгруппирован по разделам, чтобы не искать среди 39 строк. */
  const groups = (['catalog', 'cart', 'checkout', 'ui'] as Area[])
    .map((area) => ({ area, items: knownBugs.filter((b) => b.area === area) }))
    .filter((g) => g.items.length > 0);

  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-start gap-2">
          <button className="flex-1 text-left" onClick={() => setOpen(!open)}>
            <p className="font-medium">{report.title}</p>
            <p className="text-xs text-slate-500">
              {report.login} · {formatDuration(report.elapsedSec)} от старта ·{' '}
              {new Date(report.createdAt).toLocaleString('ru-RU')}
            </p>
          </button>
          {report.bugCode && (
            <Badge className="border-slate-300 bg-white font-mono" title="Засчитано как этот дефект">
              {report.bugCode}
            </Badge>
          )}
          {knownBug && (
            <Badge className={SEVERITY_STYLES[knownBug.severity]}>
              {SEVERITY_LABELS[knownBug.severity]}
            </Badge>
          )}
          <Badge>{AREA_LABELS[report.area]}</Badge>
          <Badge className={STATUS_STYLES[report.status]}>{STATUS_LABELS[report.status]}</Badge>
          {report.status === 'accepted' && (
            <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">
              +{report.score}
            </Badge>
          )}
          {match && (
            <Badge
              className={cn('gap-1', CONFIDENCE_STYLES[match.confidence])}
              title={
                match.matched.length
                  ? `Сработали слова: ${match.matched.join(', ')}`
                  : 'Ключевые слова не найдены'
              }
            >
              <Wand2 className="h-3 w-3" />
              {match.code ? `${match.code} · ` : ''}
              {match.duplicate ? 'повтор' : CONFIDENCE_LABELS[match.confidence]}
            </Badge>
          )}
        </div>

        {honeypot && (
          <div
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm"
            data-testid="honeypot-hit"
          >
            <p className="flex items-center gap-1.5 font-medium text-amber-900">
              <Eye className="h-4 w-4" />
              Попался на приманку: «{honeypot}»
            </p>
            <p className="text-amber-800">
              Такого промокода в магазине нет — он показывается только на закрытой витрине.
              Значит, участник снимал оверлей до старта игры.
            </p>
          </div>
        )}

        {knownBug && match && (
          <div
            className={cn(
              'rounded-lg border px-3 py-2 text-sm',
              match.confidence === 'high'
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50',
            )}
            data-testid="match-detail"
          >
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {match.confidence === 'high' ? 'Распознано как' : 'Похоже на'} · {knownBug.code}
              {match.duplicate && ' · повтор'}
            </p>
            <p className="font-medium">{knownBug.title}</p>
            <p className="text-slate-600">{knownBug.hint}</p>
            {match.matched.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Сработали слова: {match.matched.join(', ')}
              </p>
            )}
          </div>
        )}

        {open && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <div>
              <label className="label">Какой это дефект</label>
              <select
                className="field"
                value={selectedCode}
                onChange={(e) => onVerdict(report, { bugCode: e.target.value })}
                data-testid={`bug-code-${report.id}`}
              >
                <option value="">— не из списка —</option>
                {groups.map((g) => (
                  <optgroup key={g.area} label={AREA_LABELS[g.area]}>
                    {g.items.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.code} — {b.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {knownBugs.length === 0
                  ? 'Эталонный список не загружен: он хранится в проекте Apps Script и приходит по паролю организатора. Проверьте, что в проект добавлен файл Reference.gs.'
                  : selectedBug
                    ? `${SEVERITY_LABELS[selectedBug.severity]} · ${plural(SEVERITY_POINTS[selectedBug.severity], 'балл', 'балла', 'баллов')} · ${selectedBug.hint}`
                    : 'Без выбора находка не попадёт в покрытие и итоги игры — баллы проставьте вручную.'}
              </p>
              {match?.code && match.code !== selectedCode && (
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-orange-700 underline"
                  onClick={() => onVerdict(report, { bugCode: match.code })}
                  data-testid={`use-suggestion-${report.id}`}
                >
                  Авторазбор предлагает {match.code} — подставить
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() =>
                  onVerdict(report, {
                    status: 'accepted',
                    score: report.score || suggestedScore,
                    reviewComment: comment,
                    bugCode: selectedCode,
                  })
                }
                data-testid={`accept-${report.id}`}
              >
                Принять (+{report.score || suggestedScore})
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  onVerdict(report, {
                    status: 'duplicate',
                    score: 0,
                    reviewComment: comment,
                    bugCode: selectedCode,
                  })
                }
                data-testid={`duplicate-${report.id}`}
              >
                Дубликат
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  onVerdict(report, { status: 'rejected', score: 0, reviewComment: comment })
                }
                data-testid={`reject-${report.id}`}
              >
                Отклонить
              </Button>
              <input
                type="number"
                className="field w-24"
                value={report.score}
                min={0}
                onChange={(e) => onVerdict(report, { score: Number(e.target.value) || 0 })}
                title="Баллы"
              />
              <input
                className="field flex-1 min-w-[180px]"
                placeholder="Комментарий валидатора"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onBlur={() => onVerdict(report, { reviewComment: comment })}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const ImportModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onImport: (code: string) => void;
}> = ({ open, onClose, onImport }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(0);

  function submit() {
    setError('');
    const codes = value
      .split(/\n{2,}|\s*\n\s*/)
      .map((c) => c.trim())
      .filter(Boolean);
    let ok = 0;
    for (const code of codes) {
      try {
        onImport(code);
        ok += 1;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось разобрать код');
      }
    }
    setDone(ok);
    if (ok > 0) setValue('');
  }

  return (
    <Modal open={open} onClose={onClose} title="Импорт результатов участников">
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Вставьте коды результатов — по одному в строке. Повторный импорт того же участника
          заменяет его предыдущие данные.
        </p>
        <textarea
          className="field h-40 font-mono text-xs"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="eyJwYXJ0aWNpcGFudCI6..."
        />
        {error && <Alert tone="error">{error}</Alert>}
        {done > 0 && <Alert tone="success">Импортировано участников: {done}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
          <Button onClick={submit} disabled={!value.trim()}>
            Импортировать
          </Button>
        </div>
      </div>
    </Modal>
  );
};
