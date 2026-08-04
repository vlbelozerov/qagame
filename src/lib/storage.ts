import type { AdminSnapshot, BugReport, Participant, SessionState } from './types';

const KEY = {
  session: 'qagame.session',
  participant: 'qagame.participant',
  reports: 'qagame.reports',
  /** id репортов, подтверждённых сервером — чтобы не слать их повторно. */
  synced: 'qagame.synced',
  /** Сводка админки в офлайн-режиме: импортированные участники и проставленные вердикты. */
  admin: 'qagame.admin',
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

  getAdminData: () => read<AdminSnapshot>(KEY.admin, { participants: [], reports: [] }),
  setAdminData: (data: AdminSnapshot) => write(KEY.admin, data),

  /** Полный сброс данных участника — используется при смене участника в одном браузере. */
  clearPlayerData: () => {
    [KEY.session, KEY.participant, KEY.reports, KEY.synced].forEach((k) =>
      localStorage.removeItem(k),
    );
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
