export type Severity = 'blocker' | 'critical' | 'major' | 'minor' | 'trivial';
export type Area = 'catalog' | 'cart' | 'checkout' | 'ui' | 'other';
export type ValidationStatus = 'pending' | 'accepted' | 'rejected' | 'duplicate';

export interface BugReport {
  /** Стабильный id, генерируется на клиенте — нужен для идемпотентной отправки. */
  id: string;
  /** Номер запуска игры, в котором заведён дефект. Игра одна, но запусков может быть несколько. */
  round: number;
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
  /** Секунды от старта игры до момента создания репорта. */
  elapsedSec: number;
  /** Проставляется админом. */
  status: ValidationStatus;
  /** Баллы за дефект, проставляет админ. */
  score: number;
  /** Комментарий валидатора. */
  reviewComment: string;
  /**
   * Код эталонного дефекта, проставленный при разборе. Пусто — разбор ещё не
   * состоялся или находка не из списка. Именно по этому полю считается покрытие
   * и номинации: догадка матчера — лишь подсказка, решает организатор.
   */
  bugCode?: string;
  /** Время последнего изменения, ISO. Используется для разрешения конфликтов. */
  updatedAt: string;
}

export interface Participant {
  login: string;
  /** Номер запуска игры, в котором участник играет. */
  round: number;
  /** Начало игры для участника, ISO. */
  startedAt: string;
  /** Последняя активность, ISO. */
  lastSeenAt: string;
  /** Время отправки итогов, ISO. Пусто — участник ещё в игре. */
  finishedAt: string;
  /**
   * Признак, что участник взаимодействовал с витриной, пока она была закрыта:
   * снял оверлей через инструменты разработчика или кликал сквозь него.
   */
  peeked?: boolean;
}

export interface SessionState {
  role: 'player' | 'admin';
  login: string;
  /** Пароль админа — держим в памяти сессии для авторизации запросов к Apps Script. */
  adminSecret?: string;
}

/**
 * Состояние игры. В онлайн-режиме живёт в Google-таблице и общее для всех;
 * в офлайне — в localStorage браузера организатора.
 *
 * Игра одна и проходит в три состояния: не началась → идёт → завершена. Счётчик
 * `number` остаётся техническим: он растёт при повторном запуске и не даёт смешать
 * находки прежней игры с новыми. Участнику номер не показывается.
 */
export interface GameState {
  /** Номер запуска; 0 — игра ещё ни разу не запускалась. */
  number: number;
  status: 'idle' | 'running' | 'finished';
  /** Название игры, показывается участникам. Необязательно. */
  title: string;
  /** Начало игры, ISO. */
  startedAt: string;
  /** Автоматическое окончание, ISO. Пусто — игра без таймера. */
  endsAt: string;
  /** Фактическое закрытие игры организатором, ISO. */
  finishedAt: string;
}


export const EMPTY_GAME: GameState = {
  number: 0,
  status: 'idle',
  title: '',
  startedAt: '',
  endsAt: '',
  finishedAt: '',
};

export const GAME_STATUS_LABELS: Record<GameState['status'], string> = {
  idle: 'Игра ещё не началась',
  running: 'Игра идёт',
  finished: 'Игра завершена',
};

export interface SyncPayload {
  participant: Participant;
  reports: BugReport[];
}

export interface AdminSnapshot {
  participants: Participant[];
  reports: BugReport[];
  round: GameState;
}

export interface Nomination {
  /** Ключ для React и тестов. */
  key: string;
  emoji: string;
  title: string;
  /** Кому досталась номинация: логин или название дефекта. */
  winner: string;
  /** Пояснение: за что именно. */
  detail: string;
  /**
   * Логины победителей отдельным полем: по нему участник узнаёт свои номинации.
   * Сравнивать с winner нельзя — там может стоять название дефекта.
   */
  winnerLogins: string[];
}

/** Строка турнирной таблицы по итогам игры. */
export interface StandingRow {
  place: number;
  login: string;
  score: number;
  accepted: number;
  rejected: number;
  duplicate: number;
  total: number;
  /** Находки, которые не повторил больше никто. */
  unique: number;
  /** Секунды от старта игры до первой засчитанной находки; -1 — засчитанных нет. */
  firstAcceptedSec: number;
}

/**
 * Итоги игры, опубликованные организатором.
 *
 * Считаются в админке (только там есть эталонный список) и складываются на сервер
 * целиком: участник забирает готовый результат одним запросом и не может собрать
 * его сам — эталонного списка в его сборке нет.
 */
export interface PublishedResults {
  round: number;
  /** Название игры на момент публикации. */
  title: string;
  publishedAt: string;
  participants: number;
  accepted: number;
  totalReports: number;
  foundBugs: number;
  knownBugs: number;
  standings: StandingRow[];
  nominations: Nomination[];
  /** Дефекты, которые не нашёл никто, — без подсказок и ключевых слов. */
  missed: { code: string; title: string }[];
}

/** Шкала критичности принята в компании: правки здесь меняют её во всём приложении. */
export const SEVERITY_LABELS: Record<Severity, string> = {
  blocker: 'Блокирующий',
  critical: 'Критический',
  major: 'Высокий',
  minor: 'Средний',
  trivial: 'Низкий',
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
