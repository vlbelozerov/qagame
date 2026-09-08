import { chromium } from 'playwright';

/**
 * Вход переживает обновление страницы.
 *
 * Участник хранится в localStorage, организатор — в sessionStorage вместе с паролем:
 * F5 вход не теряет, закрытая вкладка забывает пароль. Отдельно проверяем браузер,
 * который запрещает хранилище: играть можно, но участника предупреждают заранее.
 *
 * Запуск:
 *   npm run build && npx vite preview --port 4176 &
 *   node scripts/e2e/check-session.mjs
 *
 * Playwright в зависимости проекта не входит — поставьте его разово:
 *   npm i -D playwright
 */

const CHROME = process.env.CHROME_PATH ?? undefined;
const ok = (n, v, d = '') => { console.log(`${v ? '✓' : '✗ ПРОВАЛ'} ${n}${d ? ' — ' + d : ''}`); if (!v) process.exitCode = 1; };
const game = { number: 1, status: 'running', title: 'Игра', startedAt: new Date().toISOString(), endsAt: '', finishedAt: '' };
const server = async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (body.action === 'round') return json({ ok: true, result: game });
  if (body.action === 'results') return json({ ok: true, result: null });
  if (body.action === 'adminSnapshot') return json({ ok: true, result: { round: game, participants: [], reports: [] } });
  if (body.action === 'adminReference') return json({ ok: true, result: [] });
  if (body.action === 'submit') return json({ ok: true, result: { accepted: [], rejected: [], round: game, verdicts: [] } });
  return json({ ok: true, result: { ok: true } });
};
const BASE = process.env.QAGAME_URL ?? 'http://localhost:4176/';
const b = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

// --- Организатор: обновление страницы больше не выкидывает ---
{
  const p = await b.newPage();
  await p.route('**/macros/s/**', server);
  await p.goto(BASE);
  await p.getByTestId('mode-admin').click();
  await p.getByTestId('login-input').fill('admin');
  await p.getByTestId('password-input').fill('секрет');
  await p.getByTestId('submit-login').click();
  await p.getByTestId('admin-game-status').waitFor();
  await p.reload();
  await p.waitForTimeout(1200);
  ok('организатор остался в админке после F5', (await p.getByTestId('admin-game-status').count()) === 1,
    (await p.getByTestId('submit-login').count()) ? 'показан экран входа' : '');
  const disk = await p.evaluate(() => JSON.stringify(localStorage));
  ok('пароля нет в localStorage', !disk.includes('секрет'), disk.slice(0, 120));
  const tab = await p.evaluate(() => sessionStorage.getItem('qagame.admin-session') ?? '');
  ok('сессия организатора — во вкладке', tab.includes('admin'), tab.slice(0, 80));
  await p.close();
}

// --- Новая вкладка пароль не помнит ---
{
  const p = await b.newPage();
  await p.route('**/macros/s/**', server);
  await p.goto(BASE);
  ok('в новой вкладке организатор не залогинен', (await p.getByTestId('submit-login').count()) === 1);
  await p.close();
}

// --- Браузер запрещает хранилище: участника предупреждают ---
{
  const p = await b.newPage();
  await p.addInitScript(() => {
    const boom = () => { throw new DOMException('denied', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
  });
  await p.route('**/macros/s/**', server);
  await p.goto(BASE);
  await p.waitForTimeout(500);
  const main = await p.locator('main').innerText();
  ok('видно предупреждение о запрете хранилища', main.includes('запрещает сайту сохранять данные'),
    main.slice(0, 120).replace(/\n/g, ' | '));
  ok('войти при этом всё равно можно', (await p.getByTestId('submit-login').count()) === 1);
  await p.close();
}
// --- Участник: находки и вход на месте после обновления ---
{
  const p = await b.newPage();
  await p.route('**/macros/s/**', server);
  await p.goto(BASE);
  await p.getByTestId('login-input').fill('reload.user');
  await p.getByTestId('submit-login').click();
  await p.getByTestId('quick-title').waitFor();
  await p.getByTestId('quick-title').fill('корзина считает неправильно');
  await p.getByTestId('quick-add').click();
  await p.waitForTimeout(700);
  await p.reload();
  await p.waitForTimeout(1200);
  ok('участник остался в игре после F5', (await p.getByTestId('quick-title').count()) === 1);
  const reports = await p.evaluate(() => JSON.parse(localStorage.getItem('qagame.reports') ?? '[]').length);
  ok('находки на месте', reports === 1, `находок: ${reports}`);
  await p.close();
}

await b.close();
