import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
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
  Trash2,
} from 'lucide-react';
import { config } from '@/config';
import { Alert, Badge, Button, Card, CardContent, Modal, Spinner, cn } from '@/components/ui';
import { newId, storage } from '@/lib/storage';
import { encodeSnapshot, isOnlineMode, pushProgress } from '@/lib/sync';
import {
  AREA_LABELS,
  SEVERITY_LABELS,
  SEVERITY_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  type Area,
  type BugReport,
  type Participant,
  type Severity,
} from '@/lib/types';
import { ShoppingCartApp } from '@/sandbox/ShoppingCart';

type SyncState = 'idle' | 'syncing' | 'ok' | 'error';

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
    return { login, startedAt: now, lastSeenAt: now, finishedAt: '' };
  });
  const [reports, setReports] = useState<BugReport[]>(() =>
    storage.getReports().filter((r) => r.login === login),
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BugReport | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState('');
  const [finishOpen, setFinishOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Держим свежие данные в ref, чтобы интервал синхронизации не пересоздавался на каждый ввод.
  const latest = useRef({ participant, reports });
  latest.current = { participant, reports };

  useEffect(() => storage.setParticipant(participant), [participant]);
  useEffect(() => storage.setReports(reports), [reports]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const startedMs = new Date(participant.startedAt).getTime();
  const elapsedSec = Math.max(0, Math.floor((now - startedMs) / 1000));
  const remainingSec = config.roundMinutes > 0 ? config.roundMinutes * 60 - elapsedSec : null;
  const timeIsUp = remainingSec !== null && remainingSec <= 0;

  const sync = useCallback(async (silent: boolean) => {
    if (!isOnlineMode()) return;
    if (!silent) setSyncState('syncing');
    try {
      const snapshot = {
        ...latest.current.participant,
        lastSeenAt: new Date().toISOString(),
      };
      await pushProgress(snapshot, latest.current.reports);
      storage.addSyncedIds(latest.current.reports.map((r) => r.id));
      setSyncState('ok');
      setSyncError('');
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

  function saveReport(draft: typeof EMPTY_DRAFT) {
    const stamp = new Date().toISOString();
    if (editing) {
      setReports((prev) =>
        prev.map((r) => (r.id === editing.id ? { ...r, ...draft, updatedAt: stamp } : r)),
      );
    } else {
      const report: BugReport = {
        id: newId(),
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
    }
    setFormOpen(false);
    setEditing(null);
    setTimeout(() => void sync(true), 0);
  }

  function deleteReport(id: string) {
    setReports((prev) => prev.filter((r) => r.id !== id));
    setTimeout(() => void sync(true), 0);
  }

  function finishRound() {
    const finished = { ...participant, finishedAt: new Date().toISOString() };
    setParticipant(finished);
    latest.current = { participant: finished, reports };
    setFinishOpen(true);
    void sync(false);
  }

  const stats = useMemo(() => {
    const bySeverity = reports.reduce<Record<string, number>>((acc, r) => {
      acc[r.severity] = (acc[r.severity] ?? 0) + 1;
      return acc;
    }, {});
    return { total: reports.length, bySeverity };
  }, [reports]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
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
                timeIsUp && 'border-rose-200 bg-rose-100 text-rose-800',
              )}
              title="Время раунда"
            >
              <Clock className="h-3.5 w-3.5" />
              {remainingSec === null
                ? formatDuration(elapsedSec)
                : timeIsUp
                  ? 'время вышло'
                  : formatDuration(remainingSec)}
            </Badge>

            <Badge className="gap-1 border-orange-200 bg-orange-100 text-orange-800">
              <Flag className="h-3.5 w-3.5" />
              дефектов: {stats.total}
            </Badge>

            <SyncBadge state={syncState} error={syncError} onRetry={() => void sync(false)} />

            <Button size="sm" onClick={() => setFormOpen(true)} data-testid="open-bug-form">
              <Plus className="h-4 w-4" />
              Завести дефект
            </Button>
            <Button size="sm" variant="secondary" onClick={finishRound} data-testid="finish-round">
              <CheckCircle2 className="h-4 w-4" />
              Завершить
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
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {participant.finishedAt && (
          <div className="mb-4">
            <Alert tone="success">
              Раунд завершён в {new Date(participant.finishedAt).toLocaleTimeString('ru-RU')}. Можно
              продолжать добавлять дефекты — время фиксации у каждого своё.
            </Alert>
          </div>
        )}
        {timeIsUp && !participant.finishedAt && (
          <div className="mb-4">
            <Alert tone="error">
              Время раунда истекло. Завершите раунд, чтобы зафиксировать результат.
            </Alert>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <section>
            <Card className="mb-4 border-orange-200 bg-orange-50">
              <CardContent className="flex items-start gap-3 py-3 text-sm text-orange-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Ниже — интернет-магазин с намеренно внесёнными дефектами. Проверяйте каталог,
                  корзину и оформление заказа. Известные промокоды: <b>SALE10</b>, <b>QA2026</b>.
                  Бесплатная доставка заявлена при заказе свыше 5000 ₽.
                </p>
              </CardContent>
            </Card>
            <ShoppingCartApp />
          </section>

          <aside className="space-y-3">
            <Card>
              <CardContent className="space-y-2">
                <h3 className="font-semibold">Мои дефекты</h3>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(SEVERITY_LABELS) as Severity[]).map((s) =>
                    stats.bySeverity[s] ? (
                      <Badge key={s} className={SEVERITY_STYLES[s]}>
                        {SEVERITY_LABELS[s]}: {stats.bySeverity[s]}
                      </Badge>
                    ) : null,
                  )}
                </div>
                {reports.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Пока ничего не заведено. Нашли проблему — нажмите «Завести дефект».
                  </p>
                )}
              </CardContent>
            </Card>

            {reports.map((r) => (
              <Card key={r.id}>
                <CardContent className="space-y-2 py-3">
                  <div className="flex items-start gap-2">
                    <p className="flex-1 font-medium leading-tight">{r.title}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                      aria-label="Редактировать"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteReport(r.id)}
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge className={SEVERITY_STYLES[r.severity]}>
                      {SEVERITY_LABELS[r.severity]}
                    </Badge>
                    <Badge>{AREA_LABELS[r.area]}</Badge>
                    <Badge className={STATUS_STYLES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                    <Badge className="gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(r.elapsedSec)}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </aside>
        </div>
      </main>

      <BugFormModal
        open={formOpen}
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
        reports={reports}
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

const BugFormModal: React.FC<{
  open: boolean;
  initial: BugReport | null;
  onClose: () => void;
  onSave: (draft: typeof EMPTY_DRAFT) => void;
}> = ({ open, initial, onClose, onSave }) => {
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
        : EMPTY_DRAFT,
    );
  }, [open, initial]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (draft.title.trim().length < 5) return setError('Заголовок должен быть содержательным');
    if (draft.steps.trim().length < 5) return setError('Опишите шаги воспроизведения');
    if (!draft.actual.trim()) return setError('Опишите фактический результат');
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Серьёзность</label>
            <select
              className="field"
              value={draft.severity}
              onChange={(e) => setDraft({ ...draft, severity: e.target.value as Severity })}
              data-testid="bug-severity"
            >
              {(Object.keys(SEVERITY_LABELS) as Severity[]).map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Раздел</label>
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
          <label className="label">Шаги воспроизведения</label>
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
            <label className="label">Ожидаемый результат</label>
            <textarea
              className="field min-h-[72px]"
              value={draft.expected}
              onChange={(e) => setDraft({ ...draft, expected: e.target.value })}
              data-testid="bug-expected"
            />
          </div>
          <div>
            <label className="label">Фактический результат</label>
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

export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
