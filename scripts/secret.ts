import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { KnownBug } from '../src/lib/knownBugs';

/**
 * Шифрование эталонного списка.
 *
 * Репозиторий публичный, поэтому ответы в нём лежат только шифротекстом
 * (`secret/known-bugs.enc`), а расшифрованный файл (`secret/known-bugs.json`)
 * не отслеживается git и живёт только на машине организатора.
 *
 * Ключ берётся из переменной окружения QAGAME_SECRET — в репозиторий он не
 * попадает никогда. Алгоритм: AES-256-GCM, ключ выводится scrypt со случайной
 * солью, целостность проверяется тегом GCM (подменить шифротекст незаметно нельзя).
 */

export const PLAIN_PATH = 'secret/known-bugs.json';
export const CIPHER_PATH = 'secret/known-bugs.enc';

interface Envelope {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

function secretFromEnv(): string {
  const secret = (process.env.QAGAME_SECRET ?? '').trim();
  if (!secret) {
    throw new Error(
      'Не задан QAGAME_SECRET — пароль, которым зашифрован эталонный список.\n' +
        'Пример: QAGAME_SECRET="ваш-пароль" npm run reference:unlock',
    );
  }
  return secret;
}

export function encrypt(plain: string, secret = secretFromEnv()): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const envelope: Envelope = {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(envelope, null, 2) + '\n';
}

export function decrypt(envelopeJson: string, secret = secretFromEnv()): string {
  const envelope = JSON.parse(envelopeJson) as Envelope;
  const key = scryptSync(secret, Buffer.from(envelope.salt, 'base64'), 32);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // GCM не различает «не тот пароль» и «испорченный файл» — сообщаем про оба.
    throw new Error('Не удалось расшифровать список: неверный QAGAME_SECRET или повреждён файл.');
  }
}

/**
 * Эталонный список для сборочных скриптов: берём расшифрованный файл, а если его
 * нет — расшифровываем на лету. Без пароля возвращаем null: сборка сайта не должна
 * падать у того, кто просто клонировал репозиторий.
 */
export function loadReference(): KnownBug[] | null {
  if (existsSync(PLAIN_PATH)) {
    return JSON.parse(readFileSync(PLAIN_PATH, 'utf8')) as KnownBug[];
  }
  if (!existsSync(CIPHER_PATH) || !process.env.QAGAME_SECRET) return null;
  return JSON.parse(decrypt(readFileSync(CIPHER_PATH, 'utf8'))) as KnownBug[];
}

/** `npm run reference:lock` — зашифровать расшифрованный файл в шифротекст. */
export function lock(): void {
  if (!existsSync(PLAIN_PATH)) {
    throw new Error(`Нет файла ${PLAIN_PATH} — шифровать нечего.`);
  }
  writeFileSync(CIPHER_PATH, encrypt(readFileSync(PLAIN_PATH, 'utf8')), 'utf8');
  console.log(`Зашифровано: ${PLAIN_PATH} → ${CIPHER_PATH}`);
}

/** `npm run reference:unlock` — расшифровать список для правок и сборки. */
export function unlock(): void {
  if (!existsSync(CIPHER_PATH)) {
    throw new Error(`Нет файла ${CIPHER_PATH} — расшифровывать нечего.`);
  }
  writeFileSync(PLAIN_PATH, decrypt(readFileSync(CIPHER_PATH, 'utf8')), 'utf8');
  console.log(`Расшифровано: ${CIPHER_PATH} → ${PLAIN_PATH} (файл не отслеживается git)`);
}

const command = process.argv[2];
if (command === 'lock') lock();
if (command === 'unlock') unlock();
