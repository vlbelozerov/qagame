import { writeFileSync } from 'node:fs';
import { KNOWN_BUGS } from '../src/lib/knownBugs';

/**
 * Собирает Reference.gs для Apps Script из эталонного списка.
 *
 * Список не должен попадать в браузер участника, поэтому клиент его не импортирует,
 * а получает от сервера после проверки пароля организатора. Здесь тот же список
 * превращается в файл, который организатор кладёт в свой приватный проект Apps Script.
 *
 * Запуск: npm run build:reference
 */

const header = `/**
 * Эталонный список дефектов витрины. Сгенерирован из src/lib/knownBugs.ts
 * командой \`npm run build:reference\` — правьте исходник, а не этот файл.
 *
 * Лежит в приватном проекте Apps Script и отдаётся только по паролю организатора,
 * поэтому в браузер участника не попадает.
 */

var KNOWN_BUGS = `;

const body = JSON.stringify(KNOWN_BUGS, null, 2);
writeFileSync('google-apps-script/Reference.gs', `${header}${body};\n`, 'utf8');

console.log(`Reference.gs собран: ${KNOWN_BUGS.length} дефектов`);
