import React, { useState } from 'react';
import { config } from '@/config';
import { HomePage } from '@/pages/HomePage';
import { PlayerPage } from '@/pages/PlayerPage';
import { AdminPage } from '@/pages/AdminPage';
import { guestLogin, storage } from '@/lib/storage';
import type { SessionState } from '@/lib/types';

export const App: React.FC = () => {
  const [session, setSession] = useState<SessionState | null>(() => {
    // Участник хранится в localStorage, организатор — в sessionStorage вместе с
    // паролем: обновление страницы вход не теряет, закрытая вкладка — теряет.
    const saved = storage.getSession();
    if (saved) return saved;
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
    // Пароль организатора на диск не попадает: setSession кладёт его в sessionStorage.
    storage.setSession(next);
    setSession(next);
  }

  /**
   * Выход. В демо-режиме это способ сменить участника: экран входа показывается
   * до тех пор, пока не введён новый логин.
   */
  function logout() {
    // Данные участника остаются в localStorage: случайный выход не должен стирать прогресс.
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

  if (!session) return <HomePage onLogin={login} />;

  if (session.role === 'admin') {
    return (
      <AdminPage
        adminName={session.login}
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
