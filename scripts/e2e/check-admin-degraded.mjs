import { chromium } from 'playwright';

/**
 * Админка при устаревшем бэкенде: развёрнут старый Code.gs, действия adminReference
 * в нём нет. Эталонный список недоступен — но интерфейс обязан объяснить причину и
 * продолжить работать, а не падать необработанным исключением в консоль.
 *
 * Запуск:
 *   npm run build && npx vite preview --port 4176 &
 *   node scripts/e2e/check-admin-degraded.mjs
 *
 * Playwright в зависимости проекта не входит — поставьте его разово:
 *   npm i -D playwright
 */

const BASE = process.env.QAGAME_URL ?? 'http://localhost:4176/';
const CHROME = process.env.CHROME_PATH ?? undefined;
const ok = (n, v, d = '') => { console.log(`${v ? '✓' : '✗ ПРОВАЛ'} ${n}${d ? ' — ' + d : ''}`); if (!v) process.exitCode = 1; };
const game = { number: 1, status: 'finished', title: 'Игра', startedAt: new Date(Date.now()-3600e3).toISOString(), endsAt: '', finishedAt: new Date().toISOString() };
const reports = [
  { id: 'r1', round: 1, login: 'ivan', title: 'В корзине сумма не пересчитывается', steps:'', expected:'', actual:'', severity:'major', area:'other',
    createdAt: new Date().toISOString(), elapsedSec: 60, status: 'accepted', score: 5, reviewComment: '', bugCode: '', updatedAt: '' },
];
// Ровно как у пользователя: развёрнут старый скрипт без adminReference.
const server = async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (body.action === 'adminReference') return json({ ok: false, error: 'Неизвестное действие: adminReference' });
  if (body.action === 'adminSnapshot') return json({ ok: true, result: { round: game, participants: [{login:'ivan',round:1,startedAt:game.startedAt,lastSeenAt:'',finishedAt:'',peeked:false}], reports } });
  if (body.action === 'round') return json({ ok: true, result: game });
  return json({ ok: true, result: { ok: true } });
};
const b = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const console_errors = [], page_errors = [];
p.on('pageerror', (e) => page_errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') console_errors.push(m.text()); });
await p.route('**/macros/s/**', server);
await p.goto(BASE);
await p.getByTestId('mode-admin').click();
await p.getByTestId('login-input').fill('admin');
await p.getByTestId('password-input').fill('secret');
await p.getByTestId('submit-login').click();
await p.getByTestId('open-report').waitFor();
await p.waitForTimeout(600);

ok('плашка объясняет причину', (await p.locator('main').innerText()).includes('Неизвестное действие: adminReference'));
ok('есть кнопка «Повторить»', (await p.getByTestId('retry-reference').count()) === 1);

await p.getByTestId('run-analysis').click();
await p.waitForTimeout(600);
ok('авторазбор не роняет консоль', page_errors.length === 0 && console_errors.length === 0,
  [...page_errors, ...console_errors].join(' | '));

await p.getByTestId('open-report').click();
await p.waitForTimeout(800);
const modalOpen = await p.locator('[role="dialog"]').count();
ok('итоги игры всё равно открываются', modalOpen === 1);
const modal = modalOpen ? await p.locator('[role="dialog"]').innerText() : '';
// Заголовки номинаций отрисованы в верхнем регистре — сравниваем без учёта регистра.
ok('в итогах есть номинации по участникам', /самая быстрая находка/i.test(modal),
  modal.replace(/\n/g, ' | ').slice(0, 140));
ok('нет строки «из 0»', !modal.includes('из 0'), (modal.match(/[^\n]*из 0[^\n]*/) ?? [''])[0]);
ok('консоль чистая после итогов', page_errors.length === 0 && console_errors.length === 0,
  [...page_errors, ...console_errors].join(' | '));
console.log(page_errors.length + console_errors.length ? 'ОШИБКИ В КОНСОЛИ' : 'Ошибок в консоли нет');
await b.close();
