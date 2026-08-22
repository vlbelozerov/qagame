import { config } from '@/config';
import type {
  AdminSnapshot,
  BugReport,
  Participant,
  RoundState,
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
 * В ответе приходит актуальное состояние раунда: так участник узнаёт о старте и
 * завершении, даже если организатор нажал кнопку минуту назад.
 */
export interface SubmitResult {
  accepted: string[];
  rejected: string[];
  round: RoundState;
  /** Вердикты организатора по репортам участника — без них статус вечно «на проверке». */
  verdicts: { id: string; status: ValidationStatus; score: number; reviewComment: string }[];
}

export function pushProgress(
  participant: Participant,
  reports: BugReport[],
  deletedIds: string[] = [],
) {
  return call<SubmitResult>('submit', { participant, reports, deletedIds });
}

/** Состояние раунда без авторизации — его читают и участники. */
export function fetchRound() {
  return call<RoundState>('round', {});
}

/** Организатор открывает новый раунд. */
export function startRound(
  login: string,
  password: string,
  options: { title: string; durationMinutes: number },
) {
  return call<RoundState>('adminStartRound', { login, password, ...options });
}

/** Организатор закрывает раунд: приём дефектов прекращается. */
export function finishRound(login: string, password: string) {
  return call<RoundState>('adminFinishRound', { login, password });
}

/** Полный сброс конкурса: участники и дефекты удаляются, нумерация раундов обнуляется. */
export function resetCompetition(login: string, password: string) {
  return call<RoundState>('adminReset', { login, password });
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
  verdict: { id: string; status: ValidationStatus; score: number; reviewComment: string },
) {
  return call<{ ok: true }>('adminVerdict', { login, password, ...verdict });
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
