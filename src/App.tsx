import React, { useState } from 'react';
import { LoginPage } from '@/pages/LoginPage';
import { PlayerPage } from '@/pages/PlayerPage';
import { AdminPage } from '@/pages/AdminPage';
import { storage } from '@/lib/storage';
import type { SessionState } from '@/lib/types';

export const App: React.FC = () => {
  const [session, setSession] = useState<SessionState | null>(() => {
    const saved = storage.getSession();
    // Пароль админа намеренно не переживает перезагрузку — вход в админку каждый раз заново.
    return saved?.role === 'admin' ? null : saved;
  });

  function login(next: SessionState) {
    if (next.role === 'player') {
      // Смена участника в том же браузере — начинаем с чистого листа, чтобы чужие
      // репорты не приписались новому логину.
      const previous = storage.getParticipant();
      if (previous && previous.login !== next.login) storage.clearPlayerData();
    }
    // Пароль админа не сохраняем на диск — только в памяти вкладки.
    storage.setSession(next.role === 'admin' ? null : next);
    setSession(next);
  }

  function logout() {
    // Данные участника остаются в localStorage: случайный выход не должен стирать раунд.
    storage.setSession(null);
    setSession(null);
  }

  if (!session) return <LoginPage onLogin={login} />;
  if (session.role === 'admin')
    return <AdminPage adminSecret={session.adminSecret ?? ''} onLogout={logout} />;
  return <PlayerPage login={session.login} onLogout={logout} />;
};
