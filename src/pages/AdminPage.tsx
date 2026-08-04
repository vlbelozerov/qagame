import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Download,
  Gamepad2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react';
import { config } from '@/config';
import { Alert, Badge, Button, Card, CardContent, Modal, Spinner, cn } from '@/components/ui';
import { storage } from '@/lib/storage';
import { decodeSnapshot, fetchSnapshot, isOnlineMode, pushVerdict } from '@/lib/sync';
import {
  AREA_LABELS,
  SEVERITY_LABELS,
  SEVERITY_POINTS,
  SEVERITY_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  type BugReport,
  type Participant,
  type ValidationStatus,
} from '@/lib/types';
import type { KnownBug } from '@/lib/knownBugs';
import { formatDuration } from './PlayerPage';

type Filter = 'all' | ValidationStatus;

export const AdminPage: React.FC<{
  adminSecret: string;
  onLogout: () => void;
  /** Задан только в демо-режиме: возврат к экрану участника. */
  onSwitchRole?: () => void;
}> = ({ adminSecret, onLogout, onSwitchRole }) => {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedLogin, setSelectedLogin] = useState<string>('');
  const [importOpen, setImportOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [knownBugs, setKnownBugs] = useState<KnownBug[]>([]);

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
      const snapshot = await fetchSnapshot(config.adminLogin, adminSecret);
      setParticipants(snapshot.participants);
      setReports(snapshot.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, [adminSecret]);

  useEffect(() => {
    void load();
  }, [load]);

  // В офлайн-режиме сводка живёт в localStorage, иначе вердикты терялись бы при перезагрузке.
  useEffect(() => {
    if (isOnlineMode()) return;
    if (participants.length === 0 && reports.length === 0) return;
    storage.setAdminData({ participants, reports });
  }, [participants, reports]);

  async function openReference() {
    if (knownBugs.length === 0) {
      const mod = await import('@/lib/knownBugs');
      setKnownBugs(mod.KNOWN_BUGS);
    }
    setReferenceOpen(true);
  }

  async function setVerdict(report: BugReport, patch: Partial<BugReport>) {
    const updated = { ...report, ...patch, updatedAt: new Date().toISOString() };
    setReports((prev) => prev.map((r) => (r.id === report.id ? updated : r)));
    if (!isOnlineMode()) return;
    try {
      await pushVerdict(config.adminLogin, adminSecret, {
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
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [reports, filter, selectedLogin],
  );

  function exportCsv() {
    const header = [
      'Логин',
      'Заголовок',
      'Серьёзность',
      'Раздел',
      'Шаги',
      'Ожидаемый',
      'Фактический',
      'Время от старта',
      'Создан',
      'Статус',
      'Баллы',
      'Комментарий',
    ];
    const rows = reports.map((r) => [
      r.login,
      r.title,
      SEVERITY_LABELS[r.severity],
      AREA_LABELS[r.area],
      r.steps,
      r.expected,
      r.actual,
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
          <Stat label="На проверке" value={reports.filter((r) => r.status === 'pending').length} />
        </div>

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
          <span className="text-sm text-slate-500">найдено: {visibleReports.length}</span>
        </div>

        <div className="space-y-3">
          {visibleReports.map((r) => (
            <ReportRow key={r.id} report={r} onVerdict={setVerdict} />
          ))}
        </div>
      </main>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={importCode}
      />

      <Modal
        open={referenceOpen}
        onClose={() => setReferenceOpen(false)}
        title="Эталонный список внесённых дефектов"
        wide
      >
        <div className="space-y-2">
          <p className="text-sm text-slate-500">
            Всего заложено дефектов: {knownBugs.length}. Список нужен только для валидации — не
            показывайте его участникам до конца раунда.
          </p>
          {knownBugs.map((b) => (
            <div key={b.code} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="font-mono">{b.code}</Badge>
                <Badge className={SEVERITY_STYLES[b.severity]}>{SEVERITY_LABELS[b.severity]}</Badge>
                <Badge>{AREA_LABELS[b.area]}</Badge>
              </div>
              <p className="mt-1 font-medium">{b.title}</p>
              <p className="text-sm text-slate-500">{b.hint}</p>
            </div>
          ))}
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
  onVerdict: (r: BugReport, patch: Partial<BugReport>) => void;
}> = ({ report, onVerdict }) => {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState(report.reviewComment);

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
          <Badge className={SEVERITY_STYLES[report.severity]}>
            {SEVERITY_LABELS[report.severity]}
          </Badge>
          <Badge>{AREA_LABELS[report.area]}</Badge>
          <Badge className={STATUS_STYLES[report.status]}>{STATUS_LABELS[report.status]}</Badge>
          {report.status === 'accepted' && (
            <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">
              +{report.score}
            </Badge>
          )}
        </div>

        {open && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <Detail title="Шаги воспроизведения" text={report.steps} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail title="Ожидаемый результат" text={report.expected} />
              <Detail title="Фактический результат" text={report.actual} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() =>
                  onVerdict(report, {
                    status: 'accepted',
                    score: report.score || SEVERITY_POINTS[report.severity],
                    reviewComment: comment,
                  })
                }
              >
                Принять (+{report.score || SEVERITY_POINTS[report.severity]})
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

const Detail: React.FC<{ title: string; text: string }> = ({ title, text }) => (
  <div>
    <p className="text-xs uppercase text-slate-500">{title}</p>
    <p className="whitespace-pre-wrap text-sm">{text || '—'}</p>
  </div>
);

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
