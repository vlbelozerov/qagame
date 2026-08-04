import React, { useState } from 'react';
import { Bug, LogIn, ShieldCheck } from 'lucide-react';
import { config } from '@/config';
import { Alert, Button, Card, CardContent, Spinner } from '@/components/ui';
import { sha256Hex } from '@/lib/storage';
import { adminLogin, isOnlineMode } from '@/lib/sync';
import type { SessionState } from '@/lib/types';

export const LoginPage: React.FC<{ onLogin: (s: SessionState) => void }> = ({ onLogin }) => {
  const [mode, setMode] = useState<'player' | 'admin'>('player');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function validatePlayerLogin(value: string): string {
    const v = value.trim();
    if (v.length < config.minLoginLength)
      return `Логин должен быть не короче ${config.minLoginLength} символов`;
    if (/\s/.test(v)) return 'Логин не должен содержать пробелов';
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

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <div className="mb-2 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-600 text-white">
          <Bug className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold">{config.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Найдите как можно больше дефектов и опишите их. Время идёт с момента входа.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('player');
                setError('');
              }}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                mode === 'player' ? 'bg-white shadow-sm' : 'text-slate-600'
              }`}
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
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                mode === 'admin' ? 'bg-white shadow-sm' : 'text-slate-600'
              }`}
              data-testid="mode-admin"
            >
              Администратор
            </button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label" htmlFor="login">
                {mode === 'player' ? 'Корпоративный логин' : 'Логин администратора'}
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

            <Button type="submit" className="w-full" size="lg" disabled={busy} data-testid="submit-login">
              {busy ? <Spinner /> : mode === 'player' ? <LogIn className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              {mode === 'player' ? 'Начать раунд' : 'Войти в админку'}
            </Button>
          </form>

          <p className="text-xs text-slate-500">
            {isOnlineMode()
              ? 'Результаты сохраняются автоматически на сервере конкурса.'
              : 'Офлайн-режим: результаты хранятся в браузере, в конце раунда их нужно выгрузить кодом.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
