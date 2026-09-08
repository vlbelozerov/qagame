import { loadReference } from './secret';
import { SEVERITY_LABELS, SEVERITY_POINTS } from '../src/lib/types';

/**
 * Печатает эталонный список читаемой таблицей — чтобы организатору не приходилось
 * листать JSON. Данные берутся из расшифрованного файла или расшифровываются на лету.
 *
 * Запуск: QAGAME_SECRET="..." npm run reference:show
 */

const bugs = loadReference();
if (!bugs) {
  console.error(
    'Эталонный список недоступен. Укажите пароль: QAGAME_SECRET="..." npm run reference:show',
  );
  process.exit(1);
}

const AREAS: Record<string, string> = {
  catalog: 'Каталог',
  cart: 'Корзина',
  checkout: 'Оформление заказа',
  ui: 'Интерфейс и вёрстка',
  other: 'Другое',
};

let currentArea = '';
bugs.forEach((bug) => {
  if (bug.area !== currentArea) {
    currentArea = bug.area;
    console.log(`\n=== ${AREAS[bug.area] ?? bug.area} ===\n`);
  }
  const severity = `${SEVERITY_LABELS[bug.severity]}, ${SEVERITY_POINTS[bug.severity]} б.`;
  console.log(`${bug.code}  ${bug.title}`);
  console.log(`${' '.repeat(bug.code.length + 2)}${severity} — ${bug.hint}\n`);
});

console.log(`Всего дефектов: ${bugs.length}`);
