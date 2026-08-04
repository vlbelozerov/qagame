import React, { useState } from 'react';
import { config } from '@/config';
import { LoginPage } from '@/pages/LoginPage';
import { PlayerPage } from '@/pages/PlayerPage';
import { AdminPage } from '@/pages/AdminPage';
import { guestLogin, storage } from '@/lib/storage';
import type { SessionState } from '@/lib/types';

export const App: React.FC = () => {
  const [session, setSession] = useState<SessionState | null>(() => {
    const saved = storage.getSession();
    if (saved?.role === 'player') return saved;
    // В боевом режиме пароль админа намеренно не переживает перезагрузку — вход каждый раз
    // заново. В демо-режиме пароля нет, поэтому обновление страницы не выкидывает из админки.
    if (saved?.role === 'admin') return config.requireLogin ? null : saved;
    // Демо-режим: сразу пускаем в игру под гостевым логином.
    return config.requireLogin ? null : { role: 'player', login: guestLogin() };
  });

  function login(next: SessionState) {
    if (next.role === 'player') {
      // Смена участника в том же браузере — начинаем с чистого листа, чтобы чужие
      // репорты не приписались новому логину.
      const previous = storage.getParticipant();
      if (previous && previous.login !== next.login) storage.clearPlayerData();
    }
    // Пароль админа на диск не попадает: в боевом режиме сессия админа не сохраняется вовсе,
    // в демо-режиме сохранять нечего — adminSecret там пустой.
    storage.setSession(next.role === 'admin' && config.requireLogin ? null : next);
    setSession(next);
  }

  /**
   * Выход. В демо-режиме это способ сменить участника: экран входа показывается
   * до тех пор, пока не введён новый логин.
   */
  function logout() {
    // Данные участника остаются в localStorage: случайный выход не должен стирать раунд.
    storage.setSession(null);
    setSession(null);
  }

  /** Переключение участник ↔ админка без пароля. Доступно только в демо-режиме. */
  function switchRole() {
    if (config.requireLogin) return;
    if (session?.role === 'admin') {
      const next: SessionState = { role: 'player', login: guestLogin() };
      storage.setSession(next);
      setSession(next);
    } else {
      const next: SessionState = { role: 'admin', login: config.adminLogin, adminSecret: '' };
      storage.setSession(next);
      setSession(next);
    }
  }

  const demoMode = !config.requireLogin;

  if (!session) return <LoginPage onLogin={login} />;

  if (session.role === 'admin') {
    return (
      <AdminPage
        adminSecret={session.adminSecret ?? ''}
        onLogout={logout}
        onSwitchRole={demoMode ? switchRole : undefined}
      />
    );
  }

  return (
    <PlayerPage
      login={session.login}
      onLogout={logout}
      onSwitchRole={demoMode ? switchRole : undefined}
    />
  );
};
