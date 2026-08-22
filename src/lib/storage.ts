import { EMPTY_ROUND, type AdminSnapshot, type BugReport, type Participant, type RoundState, type SessionState } from './types';

const KEY = {
  session: 'qagame.session',
  participant: 'qagame.participant',
  reports: 'qagame.reports',
  /** id репортов, подтверждённых сервером — чтобы не слать их повторно. */
  synced: 'qagame.synced',
  /** Сводка админки в офлайн-режиме: импортированные участники и проставленные вердикты. */
  admin: 'qagame.admin',
  /** Состояние раунда в офлайн-режиме. */
  round: 'qagame.round',
  /** id репортов, которые участник удалил, — их надо убрать и на сервере. */
  deleted: 'qagame.deleted',
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

export const storage = {
  getSession: () => read<SessionState | null>(KEY.session, null),
  setSession: (s: SessionState | null) =>
    s ? write(KEY.session, s) : localStorage.removeItem(KEY.session),

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

  getRound: () => read<RoundState>(KEY.round, EMPTY_ROUND),
  setRound: (r: RoundState) => write(KEY.round, r),

  getAdminData: () =>
    read<Omit<AdminSnapshot, 'round'>>(KEY.admin, { participants: [], reports: [] }),
  setAdminData: (data: Omit<AdminSnapshot, 'round'>) => write(KEY.admin, data),

  /** Полный сброс данных участника — используется при смене участника в одном браузере. */
  clearPlayerData: () => {
    [KEY.session, KEY.participant, KEY.reports, KEY.synced, KEY.deleted].forEach((k) =>
      localStorage.removeItem(k),
    );
  },

  /** Полный сброс конкурса в офлайн-режиме. */
  clearAll: () => {
    Object.values(KEY).forEach((k) => localStorage.removeItem(k));
  },
};

/**
 * Логин для демо-режима: генерируется один раз и переживает перезагрузку,
 * чтобы раунд не начинался заново при каждом обновлении страницы.
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
