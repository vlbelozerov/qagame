import { writeFileSync } from 'node:fs';
import { loadReference } from './secret';

/**
 * Собирает Reference.gs для Apps Script из эталонного списка.
 *
 * Список не должен попадать ни в браузер участника, ни в публичный репозиторий:
 * клиент получает его от сервера по паролю организатора, а в git он лежит только
 * шифротекстом. Здесь расшифрованный список превращается в файл для Apps Script.
 *
 * Запуск: QAGAME_SECRET="..." npm run build:reference
 */

const header = `/**
 * Эталонный список дефектов витрины. Сгенерирован из src/lib/knownBugs.ts
 * командой \`npm run build:reference\` — правьте исходник, а не этот файл.
 *
 * Лежит в приватном проекте Apps Script и отдаётся только по паролю организатора,
 * поэтому в браузер участника не попадает.
 */

var KNOWN_BUGS = `;

const KNOWN_BUGS = loadReference();
if (!KNOWN_BUGS) {
  throw new Error(
    'Эталонный список недоступен. Расшифруйте его: QAGAME_SECRET="..." npm run reference:unlock',
  );
}

const body = JSON.stringify(KNOWN_BUGS, null, 2);
writeFileSync('google-apps-script/Reference.gs', `${header}${body};\n`, 'utf8');

console.log(`Reference.gs собран: ${KNOWN_BUGS.length} дефектов`);
