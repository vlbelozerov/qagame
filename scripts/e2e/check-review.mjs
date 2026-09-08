import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * Проверка разбора находок: код эталонного дефекта проставляется вручную и попадает
 * и в покрытие, и в итоги игры — даже если авторазбор текст не распознал.
 *
 * Запуск:
 *   npm run build && npx vite preview --port 4176 &
 *   node scripts/e2e/check-review.mjs
 *
 * Playwright в зависимости проекта не входит — поставьте его разово:
 *   npm i -D playwright
 */

const BASE = process.env.QAGAME_URL ?? 'http://localhost:4176/';

/**
 * Эталонный список нужен, чтобы подменить им ответ сервера. Он зашифрован, поэтому
 * берём расшифрованный файл организатора или уже собранный Reference.gs; без них
 * прогон нечем наполнить — честно пропускаем.
 */
function loadReference() {
  const plain = new URL('../../secret/known-bugs.json', import.meta.url);
  if (existsSync(plain)) return JSON.parse(readFileSync(plain, 'utf8'));
  const gs = new URL('../../google-apps-script/Reference.gs', import.meta.url);
  if (existsSync(gs)) {
    const src = readFileSync(gs, 'utf8');
    return JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));
  }
  return null;
}

const KNOWN_BUGS = loadReference();
if (!KNOWN_BUGS) {
  console.log(
    'Эталонный список зашифрован и не расшифрован — прогон разбора пропущен.\n' +
      'Организатору: QAGAME_SECRET="..." npm run reference:unlock',
  );
  process.exit(0);
}
const CHROME = process.env.CHROME_PATH ?? undefined;

const ok = (n, v, d = '') => { console.log(`${v ? '✓' : '✗ ПРОВАЛ'} ${n}${d ? ' — ' + d : ''}`); if (!v) process.exitCode = 1; };

const round = {
  number: 1, status: 'finished', title: 'Разминка',
  startedAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: '',
  finishedAt: new Date().toISOString(),
};

const mk = (id, login, title, elapsedSec) => ({
  id, round: 1, login, title, steps: '', expected: '', actual: '',
  severity: 'major', area: 'other',
  createdAt: new Date(Date.now() - 3600_000 + elapsedSec * 1000).toISOString(),
  elapsedSec, status: 'pending', score: 0, reviewComment: '', bugCode: '',
  updatedAt: new Date().toISOString(),
});

// Формулировки, которые авторазбор НЕ распознаёт: ровно тот случай, из-за которого
// покрытие показывало «38 из 39 не найдено».
const reports = [
  mk('r1', 'ivan.petrov', 'сердечко считает каждый клик', 120),
  mk('r2', 'maria.k', 'на телефоне корзина не влезает', 300),
  mk('r3', 'maria.k', 'поиск не находит Кроссовки', 400),
];

const participants = ['ivan.petrov', 'maria.k'].map((login) => ({
  login, round: 1, startedAt: round.startedAt, lastSeenAt: new Date().toISOString(),
  finishedAt: '', peeked: false,
}));

const verdicts = [];
let published = null;

const server = async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  const reply = (r) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: r }) });
  switch (body.action) {
    case 'round': return reply(round);
    case 'adminLogin': return reply({ ok: true });
    case 'adminReference': return reply(KNOWN_BUGS);
    case 'adminSnapshot': return reply({ round, participants, reports });
    case 'adminVerdict': {
      verdicts.push(body);
      const row = reports.find((r) => r.id === body.id);
      if (row) Object.assign(row, { status: body.status, score: body.score, reviewComment: body.reviewComment, bugCode: body.bugCode });
      return reply({ ok: true });
    }
    case 'adminPublishResults':
      published = JSON.parse(body.payload);
      return reply({ ok: true });
    case 'results': return reply(published);
    default: return reply({ ok: true });
  }
};

const errors = [];
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const p = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await p.route('**/macros/s/**', server);
await p.goto(BASE);
await p.getByTestId('mode-admin').click();
await p.getByTestId('login-input').fill('admin');
await p.getByTestId('password-input').fill('secret');
await p.getByTestId('submit-login').click();
await p.getByTestId('open-report').waitFor();

// --- Селект доступен без запуска авторазбора ---
await p.locator('text=сердечко считает каждый клик').click();
const picker = p.getByTestId('bug-code-r1');
await picker.waitFor({ timeout: 10_000 });
const optionCount = await picker.locator('option').count();
ok('в списке все 39 дефектов плюс «не из списка»', optionCount === 40, `вариантов: ${optionCount}`);
const groupLabels = await picker.locator('optgroup').evaluateAll((els) => els.map((e) => e.label));
ok('дефекты сгруппированы по разделам', groupLabels.length === 4, groupLabels.join(' | '));

// --- Ручной выбор кода и приём ---
await picker.selectOption('CAT-10');
await p.waitForTimeout(300);
ok('код ушёл на сервер сразу при выборе',
  verdicts.some((v) => v.id === 'r1' && v.bugCode === 'CAT-10'),
  JSON.stringify(verdicts.map((v) => `${v.id}:${v.bugCode}`)));
const hint = await p.locator('[data-testid="bug-code-r1"] ~ p').first().innerText();
ok('видно критичность и баллы выбранного дефекта', /\d+ балл(а|ов)?( |$)/.test(hint), hint);

await p.getByTestId('accept-r1').click();
await p.waitForTimeout(300);
const accept = verdicts.filter((v) => v.id === 'r1').pop();
ok('приём сохранил код и баллы', accept.status === 'accepted' && accept.bugCode === 'CAT-10' && accept.score > 0,
  JSON.stringify(accept));

// --- Второй репорт: тоже вручную ---
await p.locator('text=на телефоне корзина не влезает').click();
await p.getByTestId('bug-code-r2').selectOption('UI-04');
await p.getByTestId('accept-r2').click();
await p.waitForTimeout(300);

// --- Покрытие: коды, проставленные руками, попадают в эталонный список ---
await p.getByRole('button', { name: 'Эталонный список' }).click();
await p.waitForTimeout(500);
const reference = await p.locator('[role="dialog"]').innerText();
ok('покрытие считает ручные коды', reference.includes('найдено 2 из 39'),
  (reference.match(/найдено .{0,20}/) ?? ['нет строки покрытия'])[0]);
await p.keyboard.press('Escape');
await p.waitForTimeout(300);

// --- Итоги игры: 2 найдено, 37 не найдено ---
await p.getByTestId('open-report').click();
await p.waitForTimeout(600);
const reportText = await p.locator('[role="dialog"]').innerText();
ok('не нашёл никто: 37 из 39', reportText.includes('37 из 39'),
  (reportText.match(/Не нашёл никто[^\n]*/) ?? ['строки нет'])[0]);


// Публикация — надёжнее вёрстки: смотрим сами данные итогов.
await p.getByTestId('publish-results').click();
await p.waitForTimeout(800);
ok('в опубликованных итогах найдено 2 дефекта', published?.foundBugs === 2, `foundBugs: ${published?.foundBugs}`);
ok('оба кода попали в зачёт участникам',
  published?.standings.find((r) => r.login === 'ivan.petrov')?.accepted === 1 &&
    published?.standings.find((r) => r.login === 'maria.k')?.accepted === 1,
  JSON.stringify(published?.standings.map((r) => `${r.login}:${r.accepted}`)));
ok('номинации знают названия дефектов, а не только коды',
  published?.nominations.some((n) => n.key === 'popular' && /[А-Яа-я]{4}/.test(n.winner)),
  JSON.stringify(published?.nominations.map((n) => `${n.key}:${n.winner}`)));

// --- Список не должен попадать в сборку: её открывает любой участник ---
const bundles = readdirSync(new URL('../../dist/assets/', import.meta.url))
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(new URL(`../../dist/assets/${f}`, import.meta.url), 'utf8'));
const leaked = ['CAT-01', 'регистрозависим', KNOWN_BUGS[0].hint.slice(0, 20)].filter((needle) =>
  bundles.some((b) => b.includes(needle)),
);
ok('эталонного списка нет в собранном бандле', leaked.length === 0, leaked.join(', '));

console.log(errors.length ? 'ОШИБКИ:\n' + errors.join('\n') : 'Ошибок в консоли нет');
if (errors.length) process.exitCode = 1;
await browser.close();
