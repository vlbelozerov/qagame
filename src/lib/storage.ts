import {
  EMPTY_GAME,
  type AdminSnapshot,
  type BugReport,
  type Participant,
  type PublishedResults,
  type GameState,
  type SessionState,
} from './types';

const KEY = {
  session: 'qagame.session',
  /**
   * Сессия организатора живёт в sessionStorage: она содержит пароль, и на диске
   * ему не место. sessionStorage привязан к вкладке — обновление страницы вход не
   * теряет, а закрытая вкладка забывает пароль.
   */
  adminSession: 'qagame.admin-session',
  participant: 'qagame.participant',
  reports: 'qagame.reports',
  /** id репортов, подтверждённых сервером — чтобы не слать их повторно. */
  synced: 'qagame.synced',
  /** Сводка админки в офлайн-режиме: импортированные участники и проставленные вердикты. */
  admin: 'qagame.admin',
  /** Состояние игры в офлайн-режиме. */
  round: 'qagame.round',
  /** id репортов, которые участник удалил, — их надо убрать и на сервере. */
  deleted: 'qagame.deleted',
  /** Опубликованные итоги игры в офлайн-режиме. */
  results: 'qagame.results',
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Приватный режим браузера или переполненное хранилище — молча продолжаем работать в памяти.
  }
}

/** sessionStorage может быть недоступен (приватный режим, политика браузера). */
function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const storage = {
  getSession: (): SessionState | null =>
    read<SessionState | null>(KEY.session, null) ??
    readSession<SessionState | null>(KEY.adminSession, null),

  setSession: (s: SessionState | null) => {
    try {
      localStorage.removeItem(KEY.session);
      sessionStorage.removeItem(KEY.adminSession);
      if (!s) return;
      // Пароль организатора остаётся в пределах вкладки, находки участника — на диске.
      if (s.role === 'admin') sessionStorage.setItem(KEY.adminSession, JSON.stringify(s));
      else write(KEY.session, s);
    } catch {
      // Браузер запретил хранилище — работаем в памяти, о чём предупреждаем на входе.
    }
  },

  getParticipant: () => read<Participant | null>(KEY.participant, null),
  setParticipant: (p: Participant) => write(KEY.participant, p),

  getReports: () => read<BugReport[]>(KEY.reports, []),
  setReports: (r: BugReport[]) => write(KEY.reports, r),

  getSyncedIds: () => new Set(read<string[]>(KEY.synced, [])),
  addSyncedIds: (ids: string[]) => {
    const merged = new Set([...read<string[]>(KEY.synced, []), ...ids]);
    write(KEY.synced, [...merged]);
  },

  getDeletedIds: () => read<string[]>(KEY.deleted, []),
  addDeletedId: (id: string) => {
    const merged = new Set([...read<string[]>(KEY.deleted, []), id]);
    write(KEY.deleted, [...merged]);
  },
  clearDeletedIds: () => write(KEY.deleted, []),

  getGame: () => read<GameState>(KEY.round, EMPTY_GAME),
  setGame: (r: GameState) => write(KEY.round, r),

  getResults: () => read<PublishedResults | null>(KEY.results, null),
  setResults: (r: PublishedResults) => write(KEY.results, r),

  getAdminData: () =>
    read<Omit<AdminSnapshot, 'round'>>(KEY.admin, { participants: [], reports: [] }),
  setAdminData: (data: Omit<AdminSnapshot, 'round'>) => write(KEY.admin, data),

  /**
   * Доступно ли хранилище браузера. Если нет — вход не переживёт обновление
   * страницы, и участника лучше предупредить заранее, а не после потери прогресса.
   */
  isAvailable: (): boolean => {
    try {
      const probe = 'qagame.probe';
      localStorage.setItem(probe, '1');
      const ok = localStorage.getItem(probe) === '1';
      localStorage.removeItem(probe);
      return ok;
    } catch {
      return false;
    }
  },

  /** Полный сброс данных участника — используется при смене участника в одном браузере. */
  clearPlayerData: () => {
    [KEY.session, KEY.participant, KEY.reports, KEY.synced, KEY.deleted].forEach((k) =>
      localStorage.removeItem(k),
    );
  },

  /** Полный сброс конкурса в офлайн-режиме. */
  clearAll: () => {
    Object.values(KEY).forEach((k) => localStorage.removeItem(k));
    try {
      sessionStorage.removeItem(KEY.adminSession);
    } catch {
      // Хранилище недоступно — забывать нечего.
    }
  },
};

/**
 * Логин для демо-режима: генерируется один раз и переживает перезагрузку,
 * чтобы отсчёт не начинался заново при каждом обновлении страницы.
 */
export function guestLogin(): string {
  const existing = storage.getParticipant();
  if (existing?.login) return existing.login;
  return `guest-${Math.random().toString(36).slice(2, 6)}`;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
