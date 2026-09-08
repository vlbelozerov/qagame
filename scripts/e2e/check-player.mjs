import { chromium } from 'playwright';

/**
 * Проверка того, что участник видит по ходу игры и после неё.
 *
 * Главное правило: пока игра идёт, вердиктов организатора участник не видит —
 * ни в интерфейсе, ни в хранилище браузера. Статусы, баллы и комментарии
 * появляются только на экране итогов, когда организатор их опубликовал.
 *
 * Запуск:
 *   npm run build && npx vite preview --port 4176 &
 *   node scripts/e2e/check-player.mjs
 *
 * Playwright в зависимости проекта не входит — поставьте его разово:
 *   npm i -D playwright
 */

const BASE = process.env.QAGAME_URL ?? 'http://localhost:4176/';
const CHROME = process.env.CHROME_PATH ?? undefined;

const ok = (n, v, d = '') => {
  console.log(`${v ? '✓' : '✗ ПРОВАЛ'} ${n}${d ? ' — ' + d : ''}`);
  if (!v) process.exitCode = 1;
};

let game = {
  number: 1,
  status: 'running',
  title: 'Охота на баги',
  startedAt: new Date().toISOString(),
  endsAt: '',
  finishedAt: '',
};

/** Организатор разбирает находки прямо во время игры — участник об этом знать не должен. */
const serverReports = [
  {
    id: 'srv-1', round: 1, login: 'player.one', title: 'В корзине сумма не пересчитывается',
    steps: '', expected: '', actual: '', severity: 'major', area: 'other',
    createdAt: new Date().toISOString(), elapsedSec: 30,
    status: 'accepted', score: 8, reviewComment: 'Засчитано, CART-01', bugCode: 'CART-01',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'srv-2', round: 1, login: 'player.one', title: 'Кнопка удалить убирает не тот товар',
    steps: '', expected: '', actual: '', severity: 'major', area: 'other',
    createdAt: new Date().toISOString(), elapsedSec: 90,
    status: 'rejected', score: 0, reviewComment: 'Не воспроизводится', bugCode: '',
    updatedAt: new Date().toISOString(),
  },
];

let published = null;

const server = async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  const reply = (r) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: r }),
    });
  if (body.action === 'round') return reply(game);
  if (body.action === 'results') return reply(published);
  if (body.action === 'submit') {
    return reply({ accepted: [], rejected: [], round: game, verdicts: serverReports });
  }
  return reply({ ok: true });
};

const errors = [];
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await p.route('**/macros/s/**', server);
await p.goto(BASE);
await p.getByTestId('login-input').fill('player.one');
await p.getByTestId('submit-login').click();
await p.getByTestId('quick-title').waitFor();

await p.getByTestId('quick-title').fill('Промокод применяется дважды');
await p.getByTestId('quick-add').click();
// Ждём обмена с сервером: именно в ответе приходят вердикты.
await p.waitForTimeout(1500);

// --- Во время игры статусов нет ---
await p.getByTestId('open-bug-list').click();
const list = await p.locator('[role="dialog"]').innerText();
const leaks = ['На проверке', 'Принят', 'Отклонён', 'Дубликат', '+8', 'Засчитано', 'Не воспроизводится']
  .filter((word) => list.includes(word));
ok('в списке нет статусов и баллов', leaks.length === 0, leaks.join(', ') || list.replace(/\n/g, ' | ').slice(0, 120));
ok('находки при этом видны', list.includes('Промокод применяется дважды') && list.includes('В корзине сумма'));
ok('сказано, что итоги будут позже', list.includes('будет видно в итогах'));
await p.keyboard.press('Escape');

// --- И в хранилище браузера их тоже нет ---
const stored = await p.evaluate(() => localStorage.getItem('qagame.reports') ?? '');
ok('вердиктов нет в localStorage',
  !stored.includes('"accepted"') && !stored.includes('Засчитано') && !stored.includes('Не воспроизводится'),
  stored.slice(0, 160));

// --- После публикации итогов статусы появляются ---
game = { ...game, status: 'finished', finishedAt: new Date().toISOString() };
published = {
  round: 1, title: 'Охота на баги', publishedAt: new Date().toISOString(),
  participants: 1, accepted: 1, totalReports: 2, foundBugs: 1, knownBugs: 39,
  standings: [{ place: 1, login: 'player.one', score: 8, accepted: 1, rejected: 1, duplicate: 0, total: 2, unique: 1, firstAcceptedSec: 30 }],
  nominations: [], missed: [],
};
await p.getByTestId('game-results').waitFor({ timeout: 90_000 });
// Вердикты приезжают отдельным запросом сразу после финиша — ждём их появления.
await p
  .waitForFunction(
    () => document.querySelector('[data-testid="game-results"]')?.textContent?.includes('Принят'),
    null,
    { timeout: 30_000 },
  )
  .catch(() => undefined);
const results = await p.getByTestId('game-results').innerText();
ok('в итогах статусы показаны', results.includes('Принят') && results.includes('Отклонён'),
  results.replace(/\n/g, ' | ').slice(0, 160));
ok('в итогах видны баллы и комментарий валидатора',
  results.includes('+8') && results.includes('Не воспроизводится'));

console.log(errors.length ? 'ОШИБКИ:\n' + errors.join('\n') : 'Ошибок в консоли нет');
if (errors.length) process.exitCode = 1;
await browser.close();
