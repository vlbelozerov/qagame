import { chromium } from 'playwright';

/**
 * Проверка нагрузки, которую участник создаёт на Apps Script.
 *
 * Приём находок берёт общую блокировку скрипта, и её же ждёт запуск игры. Пока
 * участник слал пустой обмен раз в 20 секунд, десятка вкладок на экране ожидания
 * хватало, чтобы организатор получил «таймаут блокировки» вместо старта. Поэтому:
 *   1) находка уходит на сервер сразу;
 *   2) когда отправлять нечего, обмен идёт не чаще heartbeatMs;
 *   3) свои строки с сервера участник запрашивает только при входе и после финиша.
 *
 * Запуск:
 *   npm run build && npx vite preview --port 4176 &
 *   node scripts/e2e/check-sync.mjs
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

/** Все обмены с сервером: по ним и считаем нагрузку. */
const submits = [];

const server = async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  const reply = (r) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: r }),
    });
  if (body.action === 'round') return reply(game);
  if (body.action === 'results') return reply(null);
  if (body.action === 'submit') {
    submits.push({
      at: Date.now(),
      reports: (body.reports || []).length,
      wantVerdicts: body.wantVerdicts,
    });
    return reply({ accepted: (body.reports || []).map((r) => r.id), rejected: [], round: game, verdicts: [] });
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
await p.waitForTimeout(1500);

// --- Вход регистрирует участника и забирает его строки ---
ok('при входе один обмен', submits.length === 1, `обменов: ${submits.length}`);
ok('и только он просит строки с сервера', submits[0]?.wantVerdicts === true, String(submits[0]?.wantVerdicts));

// --- Находка уходит немедленно, не дожидаясь тика ---
const beforeAdd = submits.length;
await p.getByTestId('quick-title').fill('Промокод применяется дважды');
await p.getByTestId('quick-add').click();
await p.waitForTimeout(1500);
const added = submits.slice(beforeAdd);
ok('находка отправлена сразу', added.length === 1, `обменов после ввода: ${added.length}`);
ok('в обмене есть находка', added[0]?.reports === 1, `находок в запросе: ${added[0]?.reports}`);
ok('лишних строк с сервера не просит', added[0]?.wantVerdicts === false, String(added[0]?.wantVerdicts));

// --- Дальше молчим: отправлять нечего ---
// Тик проверки — 20 с, отметка «я здесь» — раз в 60 с. За 25 секунд простоя
// не должно уйти ни одного обмена, хотя тик успел сработать.
const beforeIdle = submits.length;
await p.waitForTimeout(25_000);
const idle = submits.length - beforeIdle;
ok('на простое обменов нет', idle === 0, `обменов за 25 с простоя: ${idle}`);

// --- Но статус игры участник по-прежнему узнаёт: опрос состояния блокировки не берёт ---
game = { ...game, status: 'finished', finishedAt: new Date().toISOString() };
await p.waitForTimeout(20_000);
const afterFinish = submits.slice(beforeIdle);
ok('финиш вызывает обмен за вердиктами', afterFinish.length > 0, `обменов после финиша: ${afterFinish.length}`);
ok('и он просит строки с сервера', afterFinish.some((s) => s.wantVerdicts === true));

console.log(errors.length ? errors.join('\n') : 'Ошибок в консоли нет');
if (errors.length) process.exitCode = 1;
await browser.close();
