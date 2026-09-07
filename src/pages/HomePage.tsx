import React, { useEffect, useState } from 'react';
import { Bug, CheckCircle2, Clock, ListChecks, LogIn, ShieldCheck, Trophy } from 'lucide-react';
import { config } from '@/config';
import { Alert, Badge, Button, Card, CardContent, Spinner, cn } from '@/components/ui';
import { sha256Hex, storage } from '@/lib/storage';
import { adminLogin, fetchGame, isOnlineMode } from '@/lib/sync';
import {
  EMPTY_GAME,
  GAME_STATUS_LABELS,
  SEVERITY_LABELS,
  SEVERITY_POINTS,
  type GameState,
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
  const [game, setGame] = useState<GameState>(() =>
    isOnlineMode() ? EMPTY_GAME : storage.getGame(),
  );

  // Показываем состояние игры до входа: участник сразу видит, началась ли она.
  useEffect(() => {
    if (!isOnlineMode()) return;
    let alive = true;
    const tick = () =>
      fetchGame()
        .then((r) => alive && setGame(r))
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

    const adminName = login.trim();
    setBusy(true);
    try {
      if (isOnlineMode()) {
        // Логин и пароль сверяет Apps Script со своими свойствами скрипта.
        // Локально логин НЕ проверяем: в ADMIN_LOGIN может стоять что угодно,
        // и клиент не должен отклонять вход раньше сервера.
        await adminLogin(adminName, password);
      } else {
        if (adminName.toLowerCase() !== config.adminLogin.toLowerCase()) {
          throw new Error('Неверный логин или пароль');
        }
        const hash = await sha256Hex(password);
        if (hash !== config.adminPasswordSha256) throw new Error('Неверный логин или пароль');
      }
      onLogin({ role: 'admin', login: adminName, adminSecret: password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  const gameTone =
    game.status === 'running' ? 'success' : game.status === 'finished' ? 'error' : 'info';

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
              Перед вами витрина интернет-магазина «СпортАрена». В неё намеренно внесены ошибки.
              Ваша задача: за отведённое время найти их как можно больше и описать так, чтобы
              находку можно было проверить.
            </p>
          </div>

          <Alert tone={gameTone}>
            <span className="font-medium">{GAME_STATUS_LABELS[game.status]}</span>
            {game.status === 'running' && game.title && ` — ${game.title}`}
            {game.status === 'idle' &&
              ' — войти можно уже сейчас, витрина откроется у всех одновременно со стартом.'}
            {game.status === 'finished' &&
              ' — приём дефектов закрыт. Войдите под своим именем: когда организатор ' +
                'опубликует итоги, вы увидите свой результат.'}
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
              <Rule n={2} title="Дождитесь старта игры">
                До старта витрина магазина закрыта, так что ранний вход преимущества не даёт:
                игра начинается у всех одновременно. Как только организатор её завершит, приём
                находок прекращается — успевайте до сигнала.
              </Rule>
              <Rule n={3} title="Заводите дефекты одной строкой">
                Нашли проблему — опишите её в строке наверху и нажмите Enter. Больше ничего
                указывать не нужно: серьёзность дефекта определит организатор при проверке.
              </Rule>
              <Rule n={4} title="Формулируйте понятно">
                «Не работает корзина» — слишком общее описание дефекта, из него нельзя понять,
                что именно работает не так, как должно. Чем конкретнее заголовок, тем выше шанс,
                что дефект будет принят.
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
                Организатор проверяет каждую находку. Баллы зависят от того, насколько серьёзен
                сам дефект, — оценивать его вам не нужно. Отклонённые и повторные дают ноль.
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
                находки фиксируется от старта игры.
              </p>
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
                  Таймер и статус игры всегда видны в шапке.
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
