import { chromium } from 'playwright';

/**
 * Проверка, что намеренные дефекты витрины на месте.
 *
 * Гонять после любой правки магазина: «починенный» дефект — это регрессия конкурса,
 * а заметить её глазами трудно. Скрипт не заменяет эталонный список, а страхует
 * самые заметные его пункты.
 *
 * Запуск:
 *   npm run build && npx vite preview --port 4176 &
 *   node scripts/e2e/check-defects.mjs
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

const round = {
  number: 1,
  status: 'running',
  title: 'Проверка',
  startedAt: new Date().toISOString(),
  endsAt: '',
  finishedAt: '',
};

/** Подменяем Apps Script: раунд идёт, витрина открыта, ничего никуда не уходит. */
const server = async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  const reply = (r) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: r }),
    });
  if (body.action === 'round') return reply(round);
  if (body.action === 'results') return reply(null);
  if (body.action === 'submit') return reply({ accepted: [], rejected: [], round, verdicts: [] });
  return reply({ ok: true });
};

const errors = [];
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await p.route('**/macros/s/**', server);
await p.goto(BASE);
await p.getByTestId('login-input').fill('defect.check');
await p.getByTestId('submit-login').click();
await p.getByTestId('store-logo').waitFor();

const txt = (sel) => p.locator(sel).innerText();

// UI-01 / UI-02: опечатка и латинская «a» во вкладках
ok('UI-01 опечатка «Оформитьь заказ»', (await txt('[data-testid="tab-checkout"]')).includes('Оформитьь'));
ok('UI-02 латинская «a» в «Корзинa»', /Корзин[a]/.test(await txt('[data-testid="tab-cart-nav"]')));

// CAT-06: рейтинг по 5-балльной шкале подписан «из 10»
ok('CAT-06 рейтинг «4.7/10»', (await p.locator('article').first().innerText()).includes('4.7/10'));

// CAT-07: счётчик игнорирует фильтр
await p.getByTestId('category-Обувь').click();
await p.waitForTimeout(200);
ok('CAT-07 счётчик не реагирует на фильтр', (await txt('[data-testid="catalog-count"]')).includes('12'));
await p.getByTestId('category-Все категории').click();

// CAT-01: поиск регистрозависимый
await p.getByTestId('catalog-search').fill('кроссовки');
await p.waitForTimeout(300);
ok('CAT-01 поиск регистрозависим', (await p.locator('article').count()) === 0);
await p.getByTestId('catalog-search').fill('');
await p.waitForTimeout(200);

// CAT-11: быстрый просмотр всегда «в наличии» (товар 4 — остаток 0)
await p.getByTestId('quick-view-4').click({ force: true });
await p.waitForTimeout(300);
ok('CAT-11 «Товар в наличии» при нулевом остатке',
  (await p.locator('[role="dialog"]').innerText()).includes('Товар в наличии'));
await p.keyboard.press('Escape');
await p.waitForTimeout(300);

// CAT-10: повторный клик по «в избранное» наращивает счётчик
await p.getByTestId('favorite-1').click();
await p.getByTestId('favorite-1').click();
ok('CAT-10 избранное считает повторы', (await txt('[data-testid="favorites-count"]')).trim() === '2');

// CAT-12: уведомление называет предыдущий товар
await p.getByTestId('add-to-cart-1').click();
await p.getByTestId('add-to-cart-3').click();
await p.waitForTimeout(200);
const toasts = await p.locator('[data-testid="toast"]').allInnerTexts();
ok('CAT-12 тост показывает предыдущий товар',
  toasts.some((t) => t.includes('Кроссовки Stride Pro')) && toasts.length >= 2, toasts.join(' | '));

// CAT-09: повторное добавление сбрасывает количество к 1
await p.getByTestId('tab-cart-nav').click();
await p.getByTestId('qty-plus-1').click();
await p.getByTestId('qty-plus-1').click();
const before = await p.getByTestId('qty-input-1').inputValue();
await p.getByTestId('tab-catalog').click();
await p.getByTestId('add-to-cart-1').click();
await p.getByTestId('tab-cart-nav').click();
const after = await p.getByTestId('qty-input-1').inputValue();
ok('CAT-09 повторное добавление сбрасывает количество', before === '3' && after === '1', `${before} → ${after}`);

// CAT-04: в корзине товар по старой цене (в каталоге 8 990, в корзине 11 990)
// Пробел в цене неразрывный — сравниваем по нормализованному тексту.
const line1 = (await txt('[data-testid="cart-line-1"]')).replace(/\s/g, ' ');
ok('CAT-04 в корзине старая цена', line1.includes('11 990'), line1.replace(/\n/g, ' | '));

// UI-04: фиксированная ширина ломает корзину на мобильном
ok('UI-04 min-w-[720px] в корзине', (await p.locator('.min-w-\\[720px\\]').count()) === 1);

// CART-01: количество уходит в минус
await p.getByTestId('qty-minus-1').click();
await p.getByTestId('qty-minus-1').click();
ok('CART-01 количество уходит в минус', (await p.getByTestId('qty-input-1').inputValue()) === '-1');

// UI-03: в каталоге ₽, в корзине руб.
const cartText = await p.locator('[data-testid="cart-line-1"]').innerText();
await p.getByTestId('tab-catalog').click();
ok('UI-03 разные обозначения валюты',
  cartText.includes('руб.') && (await p.locator('article').first().innerText()).includes('₽'));

console.log(errors.length ? 'ОШИБКИ:\n' + errors.join('\n') : 'Ошибок в консоли нет');
if (errors.length) process.exitCode = 1;
await browser.close();
