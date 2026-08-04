export type Severity = 'blocker' | 'critical' | 'major' | 'minor' | 'trivial';
export type Area = 'catalog' | 'cart' | 'checkout' | 'ui' | 'other';
export type ValidationStatus = 'pending' | 'accepted' | 'rejected' | 'duplicate';

export interface BugReport {
  /** Стабильный id, генерируется на клиенте — нужен для идемпотентной отправки. */
  id: string;
  /** Корпоративный логин участника. */
  login: string;
  title: string;
  steps: string;
  expected: string;
  actual: string;
  severity: Severity;
  area: Area;
  /** Время создания на клиенте, ISO. */
  createdAt: string;
  /** Секунды от старта раунда участника до момента создания репорта. */
  elapsedSec: number;
  /** Проставляется админом. */
  status: ValidationStatus;
  /** Баллы за дефект, проставляет админ. */
  score: number;
  /** Комментарий валидатора. */
  reviewComment: string;
  /** Время последнего изменения, ISO. Используется для разрешения конфликтов. */
  updatedAt: string;
}

export interface Participant {
  login: string;
  /** Начало раунда, ISO. */
  startedAt: string;
  /** Последняя активность, ISO. */
  lastSeenAt: string;
  /** Время отправки итогов, ISO. Пусто — участник ещё в игре. */
  finishedAt: string;
}

export interface SessionState {
  role: 'player' | 'admin';
  login: string;
  /** Пароль админа — держим в памяти сессии для авторизации запросов к Apps Script. */
  adminSecret?: string;
}

export interface SyncPayload {
  participant: Participant;
  reports: BugReport[];
}

export interface AdminSnapshot {
  participants: Participant[];
  reports: BugReport[];
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  blocker: 'Блокирующий',
  critical: 'Критический',
  major: 'Значительный',
  minor: 'Незначительный',
  trivial: 'Тривиальный',
};

export const SEVERITY_STYLES: Record<Severity, string> = {
  blocker: 'bg-red-100 text-red-800 border-red-200',
  critical: 'bg-orange-100 text-orange-800 border-orange-200',
  major: 'bg-amber-100 text-amber-800 border-amber-200',
  minor: 'bg-sky-100 text-sky-800 border-sky-200',
  trivial: 'bg-slate-100 text-slate-700 border-slate-200',
};

/** Баллы по умолчанию, которые админка подставляет при подтверждении дефекта. */
export const SEVERITY_POINTS: Record<Severity, number> = {
  blocker: 10,
  critical: 8,
  major: 5,
  minor: 3,
  trivial: 1,
};

export const AREA_LABELS: Record<Area, string> = {
  catalog: 'Каталог',
  cart: 'Корзина',
  checkout: 'Оформление заказа',
  ui: 'Интерфейс / вёрстка',
  other: 'Другое',
};

export const STATUS_LABELS: Record<ValidationStatus, string> = {
  pending: 'На проверке',
  accepted: 'Принят',
  rejected: 'Отклонён',
  duplicate: 'Дубликат',
};

export const STATUS_STYLES: Record<ValidationStatus, string> = {
  pending: 'bg-slate-100 text-slate-700 border-slate-200',
  accepted: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  rejected: 'bg-rose-100 text-rose-800 border-rose-200',
  duplicate: 'bg-violet-100 text-violet-800 border-violet-200',
};
