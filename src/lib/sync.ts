import { config } from '@/config';
import type { KnownBug } from './knownBugs';
import type {
  AdminSnapshot,
  BugReport,
  Participant,
  PublishedResults,
  GameState,
  ValidationStatus,
} from './types';

export const isOnlineMode = () => config.syncEndpoint.trim().length > 0;

/**
 * Apps Script принимает только «простые» запросы: любой Content-Type кроме
 * text/plain, application/x-www-form-urlencoded или multipart/form-data вызовет
 * preflight OPTIONS, который Apps Script не обрабатывает и запрос упадёт по CORS.
 * Поэтому JSON уходит телом с типом text/plain.
 */
async function call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(config.syncEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
      redirect: 'follow',
    });
  } catch {
    // «Failed to fetch» здесь почти всегда означает не обрыв сети, а редирект на
    // страницу входа Google: у развёртывания доступ не «у всех». В адресной строке
    // это незаметно — там мы залогинены, — поэтому подсказываем прямо.
    throw new Error(
      'Сервер конкурса недоступен. Проверьте развёртывание Apps Script: ' +
        '«У кого есть доступ» должно быть «у всех», иначе браузер не может обратиться ' +
        'к нему со страницы. После смены настроек создайте новое развёртывание.',
    );
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { ok: boolean; error?: string; result?: T };
  if (!data.ok) throw new Error(data.error || 'Неизвестная ошибка сервера');
  return data.result as T;
}

/**
 * Отправка прогресса участника. Сервер выполняет upsert по id репорта — вызов идемпотентен.
 * В ответе приходит актуальное состояние игры: так участник узнаёт о старте и
 * завершении, даже если организатор нажал кнопку минуту назад.
 */
export interface SubmitResult {
  accepted: string[];
  rejected: string[];
  round: GameState;
  /**
   * Строки участника со стороны сервера: и вердикты организатора (без них статус
   * вечно «на проверке»), и сами находки — чтобы список восстанавливался в чужом
   * браузере или после очистки данных.
   */
  verdicts: BugReport[];
}

export function pushProgress(
  participant: Participant,
  reports: BugReport[],
  deletedIds: string[] = [],
) {
  return call<SubmitResult>('submit', { participant, reports, deletedIds });
}

/** Состояние игры без авторизации — его читают и участники. */
export function fetchGame() {
  return call<GameState>('round', {});
}

/** Организатор запускает игру. */
export function startGame(
  login: string,
  password: string,
  options: { title: string; durationMinutes: number },
) {
  return call<GameState>('adminStartRound', { login, password, ...options });
}

/** Организатор завершает игру: приём дефектов прекращается. */
export function finishGame(login: string, password: string) {
  return call<GameState>('adminFinishRound', { login, password });
}

/** Полный сброс конкурса: участники и дефекты удаляются, счётчик запусков обнуляется. */
export function resetCompetition(login: string, password: string) {
  return call<GameState>('adminReset', { login, password });
}

/** Проверка пароля админа на стороне Apps Script. */
export function adminLogin(login: string, password: string) {
  return call<{ ok: true }>('adminLogin', { login, password });
}

/** Полная выгрузка для админки. */
export function fetchSnapshot(login: string, password: string) {
  return call<AdminSnapshot>('adminSnapshot', { login, password });
}

/** Сохранение вердикта по дефекту. */
export function pushVerdict(
  login: string,
  password: string,
  verdict: {
    id: string;
    status: ValidationStatus;
    score: number;
    reviewComment: string;
    /** Код эталонного дефекта; пустая строка — находка не из списка. */
    bugCode: string;
  },
) {
  return call<{ ok: true }>('adminVerdict', { login, password, ...verdict });
}

/**
 * Эталонный список дефектов для админки.
 *
 * В бандл он не входит намеренно: файл со сборкой открыт любому участнику, и список
 * ответов из него можно было бы просто прочитать. Сервер отдаёт его только после
 * проверки пароля организатора.
 */
export function fetchReference(login: string, password: string) {
  return call<KnownBug[]>('adminReference', { login, password });
}

/**
 * Публикация итогов игры участникам. Считает их админка — только у неё есть
 * эталонный список, — а сервер лишь хранит готовый результат.
 */
export function publishResults(login: string, password: string, results: PublishedResults) {
  return call<{ ok: true }>('adminPublishResults', {
    login,
    password,
    round: results.round,
    payload: JSON.stringify(results),
  });
}

/** Итоги игры для участника. null — организатор ещё не публиковал их. */
export function fetchResults(round: number) {
  return call<PublishedResults | null>('results', { round });
}

// --- Офлайн-режим: обмен результатами через текстовый код ---

/** Кодируем UTF-8 JSON в base64 без потерь на кириллице. */
export function encodeSnapshot(payload: { participant: Participant; reports: BugReport[] }): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export function decodeSnapshot(code: string): { participant: Participant; reports: BugReport[] } {
  const binary = atob(code.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
    participant?: Participant;
    reports?: BugReport[];
  };
  if (!parsed.participant?.login || !Array.isArray(parsed.reports)) {
    throw new Error('Код не похож на выгрузку результатов');
  }
  return { participant: parsed.participant, reports: parsed.reports };
}
