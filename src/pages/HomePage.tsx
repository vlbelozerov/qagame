import React, { useEffect, useState } from 'react';
import {
  Bug,
  CheckCircle2,
  Clock,
  Flag,
  ListChecks,
  LogIn,
  ShieldCheck,
  Trophy,
} from 'lucide-react';
import { config } from '@/config';
import { Alert, Badge, Button, Card, CardContent, Spinner, cn } from '@/components/ui';
import { sha256Hex, storage } from '@/lib/storage';
import { adminLogin, fetchRound, isOnlineMode } from '@/lib/sync';
import {
  EMPTY_ROUND,
  ROUND_STATUS_LABELS,
  SEVERITY_LABELS,
  SEVERITY_POINTS,
  type RoundState,
  type SessionState,
  type Severity,
} from '@/lib/types';

/**
 * Стартовая страница: правила конкурса и вход.
 * Участнику достаточно имени, организатор входит по логину и паролю.
 */
export const HomePage: React.FC<{ onLogin: (s: SessionState) => void }> = ({ onLogin }) => {
  const [mode, setMode] = useState<'player' | 'admin'>('player');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState<RoundState>(() =>
    isOnlineMode() ? EMPTY_ROUND : storage.getRound(),
  );

  // Показываем состояние раунда до входа: участник сразу видит, началось ли уже.
  useEffect(() => {
    if (!isOnlineMode()) return;
    let alive = true;
    const tick = () =>
      fetchRound()
        .then((r) => alive && setRound(r))
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  function validatePlayerLogin(value: string): string {
    const v = value.trim();
    if (v.length < config.minLoginLength)
      return `Имя должно быть не короче ${config.minLoginLength} символов`;
    if (
      config.allowedLoginSuffixes.length > 0 &&
      !config.allowedLoginSuffixes.some((s) => v.toLowerCase().endsWith(s.toLowerCase()))
    ) {
      return `Допустимы только логины, оканчивающиеся на ${config.allowedLoginSuffixes.join(', ')}`;
    }
    return '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (mode === 'player') {
      const problem = validatePlayerLogin(login);
      if (problem) return setError(problem);
      return onLogin({ role: 'player', login: login.trim().toLowerCase() });
    }

    if (login.trim().toLowerCase() !== config.adminLogin.toLowerCase()) {
      return setError('Неверный логин или пароль');
    }

    setBusy(true);
    try {
      if (isOnlineMode()) {
        // Пароль проверяется на стороне Apps Script — в бандле его нет.
        await adminLogin(config.adminLogin, password);
      } else {
        const hash = await sha256Hex(password);
        if (hash !== config.adminPasswordSha256) throw new Error('Неверный логин или пароль');
      }
      onLogin({ role: 'admin', login: config.adminLogin, adminSecret: password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  const roundTone =
    round.status === 'running' ? 'success' : round.status === 'finished' ? 'error' : 'info';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-600 text-white">
            <Bug className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold">{config.title}</p>
            <p className="text-xs text-slate-500">Корпоративный конкурс тестировщиков</p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-5">
          <div>
            <h1 className="text-3xl font-bold leading-tight">Найдите как можно больше дефектов</h1>
            <p className="mt-2 text-slate-600">
              Перед вами витрина интернет-магазина «СпортАрена». В неё намеренно внесены ошибки —
              от опечаток до неверных расчётов в корзине. Ваша задача: за отведённое время найти
              их как можно больше и описать так, чтобы находку можно было проверить.
            </p>
          </div>

          <Alert tone={roundTone}>
            <span className="font-medium">{ROUND_STATUS_LABELS[round.status]}</span>
            {round.status === 'running' && round.title && ` — ${round.title}`}
            {round.status === 'idle' &&
              ' — дождитесь, пока организатор откроет раунд. Войти можно уже сейчас.'}
            {round.status === 'finished' &&
              ' — приём дефектов закрыт. Дождитесь следующего раунда.'}
          </Alert>

          <Card>
            <CardContent className="space-y-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <ListChecks className="h-5 w-5 text-orange-600" />
                Как это устроено
              </h2>
              <Rule n={1} title="Войдите под своим именем">
                Пароль не нужен — достаточно корпоративного логина или имени. По нему организатор
                поймёт, чьи находки засчитывать.
              </Rule>
              <Rule n={2} title="Дождитесь старта раунда">
                Дефекты принимаются только пока раунд идёт. Как только организатор закроет раунд,
                поле ввода блокируется — успевайте до сигнала.
              </Rule>
              <Rule n={3} title="Заводите дефекты одной строкой">
                Нашли проблему — опишите её в строке наверху и нажмите Enter. Обязателен только
                заголовок. Кнопка «Подробно» открывает форму с шагами воспроизведения, если хотите
                расписать находку основательно.
              </Rule>
              <Rule n={4} title="Формулируйте понятно">
                «Не работает корзина» проверить нельзя, а «Промокод SALE10 даёт 10 рублей вместо
                10 %» — можно. Чем конкретнее заголовок, тем выше шанс, что дефект засчитают.
              </Rule>
              <Rule n={5} title="Повторы не приносят баллов">
                Один и тот же дефект, заведённый дважды, засчитывается один раз. Лучше искать
                новое, чем переписывать найденное.
              </Rule>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <Trophy className="h-5 w-5 text-orange-600" />
                Как считаются баллы
              </h2>
              <p className="text-sm text-slate-600">
                Организатор проверяет каждую находку. За подтверждённый дефект начисляются баллы
                по его серьёзности; отклонённые и повторные дают ноль.
              </p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(SEVERITY_POINTS) as Severity[]).map((s) => (
                  <Badge key={s} className="gap-1">
                    {SEVERITY_LABELS[s]}
                    <span className="font-bold text-orange-700">+{SEVERITY_POINTS[s]}</span>
                  </Badge>
                ))}
              </div>
              <p className="text-sm text-slate-600">
                При равенстве баллов выше окажется тот, кто нашёл дефекты быстрее: время каждой
                находки фиксируется от старта раунда.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <Flag className="h-5 w-5 text-orange-600" />
                Где искать
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ['Каталог', 'поиск, фильтры, сортировка, карточки товаров, избранное'],
                  ['Корзина', 'количество, промокоды, доставка, итоговая сумма'],
                  ['Оформление заказа', 'валидация полей, оплата, подтверждение'],
                  ['Интерфейс', 'тексты, опечатки, вёрстка, поведение на мобильном'],
                ].map(([area, hint]) => (
                  <div key={area} className="rounded-lg border border-slate-200 p-3">
                    <p className="text-sm font-semibold">{area}</p>
                    <p className="text-sm text-slate-500">{hint}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <aside>
          <Card className="lg:sticky lg:top-6">
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('player');
                    setError('');
                  }}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition',
                    mode === 'player' ? 'bg-white shadow-sm' : 'text-slate-600',
                  )}
                  data-testid="mode-player"
                >
                  Участник
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('admin');
                    setError('');
                  }}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition',
                    mode === 'admin' ? 'bg-white shadow-sm' : 'text-slate-600',
                  )}
                  data-testid="mode-admin"
                >
                  Организатор
                </button>
              </div>

              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="label" htmlFor="login">
                    {mode === 'player' ? 'Ваше имя или логин' : 'Логин организатора'}
                  </label>
                  <input
                    id="login"
                    className="field"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    placeholder={mode === 'player' ? 'i.ivanov' : 'admin'}
                    autoComplete="username"
                    autoFocus
                    data-testid="login-input"
                  />
                </div>

                {mode === 'admin' && (
                  <div>
                    <label className="label" htmlFor="password">
                      Пароль
                    </label>
                    <input
                      id="password"
                      type="password"
                      className="field"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      data-testid="password-input"
                    />
                  </div>
                )}

                {error && <Alert tone="error">{error}</Alert>}

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={busy}
                  data-testid="submit-login"
                >
                  {busy ? (
                    <Spinner />
                  ) : mode === 'player' ? (
                    <LogIn className="h-4 w-4" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  {mode === 'player' ? 'Войти в игру' : 'Войти в админку'}
                </Button>
              </form>

              <ul className="space-y-1.5 border-t border-slate-100 pt-3 text-sm text-slate-500">
                <li className="flex items-start gap-2">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  Таймер и статус раунда всегда видны в шапке.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  {isOnlineMode()
                    ? 'Находки сохраняются автоматически, ничего отправлять руками не нужно.'
                    : 'Офлайн-режим: находки хранятся в браузере, в конце выдаётся код результата.'}
                </li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
};

const Rule: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({
  n,
  title,
  children,
}) => (
  <div className="flex gap-3">
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
      {n}
    </span>
    <div>
      <p className="font-medium leading-tight">{title}</p>
      <p className="text-sm text-slate-600">{children}</p>
    </div>
  </div>
);
