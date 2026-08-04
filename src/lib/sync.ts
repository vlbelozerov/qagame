import { config } from '@/config';
import type { AdminSnapshot, BugReport, Participant, ValidationStatus } from './types';

export const isOnlineMode = () => config.syncEndpoint.trim().length > 0;

/**
 * Apps Script принимает только «простые» запросы: любой Content-Type кроме
 * text/plain, application/x-www-form-urlencoded или multipart/form-data вызовет
 * preflight OPTIONS, который Apps Script не обрабатывает и запрос упадёт по CORS.
 * Поэтому JSON уходит телом с типом text/plain.
 */
async function call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(config.syncEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { ok: boolean; error?: string; result?: T };
  if (!data.ok) throw new Error(data.error || 'Неизвестная ошибка сервера');
  return data.result as T;
}

/** Отправка прогресса участника. Сервер выполняет upsert по id репорта — вызов идемпотентен. */
export function pushProgress(participant: Participant, reports: BugReport[]) {
  return call<{ accepted: string[] }>('submit', { participant, reports });
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
