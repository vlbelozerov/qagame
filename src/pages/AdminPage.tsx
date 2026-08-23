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
  fetchSnapshot,
  finishRound as finishRoundRequest,
  isOnlineMode,
  publishResults,
  pushVerdict,
  resetCompetition,
  startRound as startRoundRequest,
} from '@/lib/sync';
import {
  AREA_LABELS,
  EMPTY_ROUND,
  ROUND_STATUS_LABELS,
  SEVERITY_LABELS,
  SEVERITY_POINTS,
  SEVERITY_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  type BugReport,
  type Participant,
  type RoundState,
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
  buildRoundReport,
  reportToText,
  toPublishedResults,
  type RoundReport,
} from '@/lib/roundReport';
import { formatDuration } from '@/lib/format';

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
  const [round, setRound] = useState<RoundState>(() =>
    isOnlineMode() ? EMPTY_ROUND : storage.getRound(),
  );
  const [roundTitle, setRoundTitle] = useState('');
  const [roundMinutes, setRoundMinutes] = useState(config.roundMinutes);
  const [roundBusy, setRoundBusy] = useState(false);
  const [roundFilter, setRoundFilter] = useState<number | 'all'>('all');
  const [report, setReport] = useState<RoundReport | null>(null);
  const [reportCopied, setReportCopied] = useState(false);
  /** Публикация итогов участникам: пусто — ещё не публиковали в этот заход. */
  const [publishState, setPublishState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [publishError, setPublishError] = useState('');

  const load = useCallback(async () => {
    if (!isOnlineMode()) {
      // Офлайн: показываем ранее импортированные результаты и раунд участника,
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
      setRound(snapshot.round);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, [adminName, adminSecret]);

  useEffect(() => {
    void load();
  }, [load]);

  // В офлайн-режиме сводка живёт в localStorage, иначе вердикты терялись бы при перезагрузке.
  useEffect(() => {
    if (isOnlineMode()) return;
    if (participants.length === 0 && reports.length === 0) return;
    storage.setAdminData({ participants, reports });
  }, [participants, reports]);

  /**
   * Управление раундом. В онлайне состояние живёт в таблице и доходит до всех участников;
   * в офлайне пишем в localStorage — оно действует только в этом браузере.
   */
  async function applyRound(action: 'start' | 'finish' | 'reset') {
    setRoundBusy(true);
    setError('');
    try {
      if (isOnlineMode()) {
        const next =
          action === 'start'
            ? await startRoundRequest(adminName, adminSecret, {
                title: roundTitle.trim(),
                durationMinutes: roundMinutes,
              })
            : action === 'finish'
              ? await finishRoundRequest(adminName, adminSecret)
              : await resetCompetition(adminName, adminSecret);
        setRound(next);
        if (action === 'reset') {
          setParticipants([]);
          setReports([]);
          setMatches(new Map());
        }
        await load();
      } else {
        const now = new Date();
        if (action === 'start') {
          const next: RoundState = {
            number: round.number + 1,
            status: 'running',
            title: roundTitle.trim(),
            startedAt: now.toISOString(),
            endsAt:
              roundMinutes > 0
                ? new Date(now.getTime() + roundMinutes * 60_000).toISOString()
                : '',
            finishedAt: '',
          };
          storage.setRound(next);
          setRound(next);
        } else if (action === 'finish') {
          const next: RoundState = { ...round, status: 'finished', finishedAt: now.toISOString() };
          storage.setRound(next);
          setRound(next);
        } else {
          storage.clearAll();
          storage.setRound(EMPTY_ROUND);
          setRound(EMPTY_ROUND);
          setParticipants([]);
          setReports([]);
          setMatches(new Map());
        }
      }
      setRoundTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить состояние раунда');
    } finally {
      setRoundBusy(false);
    }
  }

  /** Итоги раунда: номинации считаются по принятым дефектам текущего разбора. */
  async function openReport() {
    const bugs = await loadKnownBugs();
    let current = matches;
    // Без разбора не с чем сопоставлять находки — запускаем его молча.
    if (current.size === 0) {
      current = matchAll(reports, bugs);
      setMatches(current);
    }
    const target = roundFilter === 'all' ? round.number || 1 : roundFilter;
    setReport(buildRoundReport(target, reports, current, bugs, participants));
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
      const payload = toPublishedResults(report, round);
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
      'Начать новый конкурс? Все участники, дефекты и вердикты будут удалены безвозвратно, нумерация раундов обнулится.',
    );
    if (ok) void applyRound('reset');
  }

  async function loadKnownBugs(): Promise<KnownBug[]> {
    if (knownBugs.length > 0) return knownBugs;
    const mod = await import('@/lib/knownBugs');
    setKnownBugs(mod.KNOWN_BUGS);
    return mod.KNOWN_BUGS;
  }

  async function openReference() {
    // Окно открываем сразу: если чанк со списком не загрузится, пользователь должен
    // увидеть причину, а не молча ничего не получить по нажатию.
    setReferenceOpen(true);
    setKnownBugsError('');
    try {
      await loadKnownBugs();
    } catch {
      setKnownBugsError(
        'Не удалось загрузить эталонный список. Обычно помогает обновление страницы ' +
          'с Ctrl+Shift+R: браузер держит в кэше старую версию приложения и просит файл, ' +
          'которого после обновления сайта уже нет.',
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
        .filter((r) => (roundFilter === 'all' ? true : (r.round ?? 0) === roundFilter))
        .filter((r) => {
          if (matchFilter === 'any') return true;
          const m = matches.get(r.id);
          if (matchFilter === 'duplicate') return Boolean(m?.duplicate);
          return (m?.confidence ?? 'none') === matchFilter;
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [reports, filter, selectedLogin, matchFilter, matches, roundFilter],
  );

  const bugByCode = useMemo(() => new Map(knownBugs.map((b) => [b.code, b])), [knownBugs]);

  const pendingCount = useMemo(
    () => reports.filter((r) => r.status === 'pending').length,
    [reports],
  );

  const availableRounds = useMemo(
    () => [...new Set(reports.map((r) => r.round ?? 0))].sort((a, b) => a - b),
    [reports],
  );

  /** Сводка авторазбора и покрытие эталонного списка. */
  const analysis = useMemo(() => {
    if (matches.size === 0) return null;
    const pending = reports.filter((r) => r.status === 'pending');
    const counts = { high: 0, low: 0, none: 0, duplicates: 0 };
    const foundCodes = new Map<string, Set<string>>();
    reports.forEach((r) => {
      const m = matches.get(r.id);
      if (!m) return;
      if (m.code) {
        const who = foundCodes.get(m.code) ?? new Set<string>();
        who.add(r.login);
        foundCodes.set(m.code, who);
      }
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
      'Код разбора',
      'Время от старта',
      'Создан',
      'Статус',
      'Баллы',
      'Комментарий',
    ];
    const rows = reports.map((r) => [
      r.login,
      r.title,
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
                : 'Офлайн-режим: раунд в этом браузере и импортированные коды'}
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
              Итоги раунда
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

        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Участников" value={leaderboard.length} />
          <Stat label="Всего дефектов" value={reports.length} />
          <Stat label="Подтверждено" value={reports.filter((r) => r.status === 'accepted').length} />
          <Stat label="На проверке" value={pendingCount} />
        </div>


        <Card className={cn(round.status === 'running' && 'border-emerald-300')}>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">Управление раундом</h3>
              <Badge
                className={cn(
                  round.status === 'running'
                    ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                    : round.status === 'finished'
                      ? 'border-rose-200 bg-rose-100 text-rose-800'
                      : '',
                )}
                data-testid="admin-round-status"
              >
                {ROUND_STATUS_LABELS[round.status]}
                {round.number > 0 && ` · раунд ${round.number}`}
              </Badge>
              {round.title && <span className="text-sm text-slate-500">{round.title}</span>}
            </div>

            {round.status !== 'running' ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <label className="label">Название раунда — необязательно</label>
                  <input
                    className="field"
                    value={roundTitle}
                    onChange={(e) => setRoundTitle(e.target.value)}
                    placeholder="Например: Финал, поток 2"
                    data-testid="round-title"
                  />
                </div>
                <div>
                  <label className="label">Минут (0 — без таймера)</label>
                  <input
                    type="number"
                    min={0}
                    className="field w-32"
                    value={roundMinutes}
                    onChange={(e) => setRoundMinutes(Math.max(0, Number(e.target.value) || 0))}
                    data-testid="round-minutes"
                  />
                </div>
                <Button onClick={() => void applyRound('start')} disabled={roundBusy} data-testid="start-round">
                  {roundBusy ? <Spinner /> : <Play className="h-4 w-4" />}
                  Начать раунд {round.number + 1}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-slate-600">
                  Начат в {new Date(round.startedAt).toLocaleTimeString('ru-RU')}
                  {round.endsAt
                    ? ` · автозавершение в ${new Date(round.endsAt).toLocaleTimeString('ru-RU')}`
                    : ' · без таймера, закроется вручную'}
                  .
                </p>
                <Button
                  variant="danger"
                  onClick={() => void applyRound('finish')}
                  disabled={roundBusy}
                  data-testid="finish-round-admin"
                >
                  {roundBusy ? <Spinner /> : <Square className="h-4 w-4" />}
                  Завершить раунд
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <Button variant="secondary" size="sm" onClick={confirmReset} disabled={roundBusy} data-testid="reset-competition">
                <RotateCcw className="h-4 w-4" />
                Новый конкурс — удалить все данные
              </Button>
              <span className="text-xs text-slate-500">
                {isOnlineMode()
                  ? 'Состояние раунда общее: участники увидят изменение в течение 10 секунд.'
                  : 'Офлайн-режим: раунд управляется только в этом браузере — у других участников состояние своё.'}
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
                                title="Витрину открывали до старта раунда: снят оверлей или были клики сквозь него"
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
          {availableRounds.length > 1 && (
            <>
              <span className="mx-1 h-4 w-px bg-slate-300" />
              <select
                className="field w-auto py-1 text-xs"
                value={String(roundFilter)}
                onChange={(e) =>
                  setRoundFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                }
                data-testid="round-filter"
              >
                <option value="all">Все раунды</option>
                {availableRounds.map((n) => (
                  <option key={n} value={n}>
                    Раунд {n}
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
              knownBug={
                matches.get(r.id)?.code ? bugByCode.get(matches.get(r.id)!.code) : undefined
              }
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
        title={report ? `Итоги раунда ${report.round}` : 'Итоги раунда'}
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
              показывайте его участникам до конца раунда.
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
  /** Эталонный дефект, на который указал разбор, — его текст нужен для сверки глазами. */
  knownBug?: KnownBug;
  /** Найденный в тексте маркер-приманка: такое видно только со снятым оверлеем. */
  honeypot?: string | null;
  onVerdict: (r: BugReport, patch: Partial<BugReport>) => void;
}> = ({ report, match, knownBug, honeypot, onVerdict }) => {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState(report.reviewComment);

  /**
   * Баллы предлагаются по серьёзности эталонного дефекта. Участник серьёзность не
   * указывает, поэтому если разбор ничего не нашёл — значение проставляет валидатор.
   */
  const suggestedScore = knownBug ? SEVERITY_POINTS[knownBug.severity] : SEVERITY_POINTS.minor;

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
              Значит, участник снимал оверлей до старта раунда.
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() =>
                  onVerdict(report, {
                    status: 'accepted',
                    score: report.score || suggestedScore,
                    reviewComment: comment,
                  })
                }
              >
                Принять (+{report.score || suggestedScore})
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  onVerdict(report, { status: 'duplicate', score: 0, reviewComment: comment })
                }
              >
                Дубликат
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  onVerdict(report, { status: 'rejected', score: 0, reviewComment: comment })
                }
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
