import React, { useMemo, useState } from 'react';
import { Minus, Plus, ShoppingCart as CartIcon, Search, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, cn } from '@/components/ui';
import {
  CATEGORIES,
  FREE_SHIPPING_THRESHOLD,
  PRODUCTS,
  PROMO_CODES,
  SHIPPING_COST,
  type Product,
} from './products';

/**
 * Тренажёр «Корзина покупок».
 *
 * Внимание для мейнтейнеров: дефекты в этом файле внесены НАМЕРЕННО — это предмет
 * поиска для участников конкурса. Полный перечень лежит в src/lib/knownBugs.ts
 * и подгружается только в админке. Не «чините» тут ничего без сверки с этим списком.
 */

type CartLine = { productId: number; qty: number };
type Tab = 'catalog' | 'cart' | 'checkout';
type Sort = 'default' | 'price-asc' | 'price-desc' | 'rating';

interface OrderResult {
  number: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  cardNumber: string;
  cvv: string;
  total: number;
}

const PAGE_SIZE = 6;

const money = (value: number) => value.toLocaleString('ru-RU');

export const ShoppingCartApp: React.FC = () => {
  const [tab, setTab] = useState<Tab>('catalog');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [sort, setSort] = useState<Sort>('default');
  const [page, setPage] = useState(0);
  const [promoInput, setPromoInput] = useState('');
  const [promos, setPromos] = useState<{ code: string; percent: number }[]>([]);
  const [promoError, setPromoError] = useState('');
  const [orders, setOrders] = useState<OrderResult[]>([]);

  const productById = useMemo(() => new Map(PRODUCTS.map((p) => [p.id, p])), []);

  const filtered = useMemo(() => {
    const result = PRODUCTS.filter((p) => {
      // Регистрозависимый поиск.
      const matchesQuery = query === '' || p.title.includes(query);
      const matchesCategory =
        category === CATEGORIES[0] ||
        p.category === category ||
        // Категория «Периферия» подмешивает аксессуары.
        (category === 'Периферия' && p.category === 'Аксессуары');
      return matchesQuery && matchesCategory;
    });

    if (sort === 'price-asc') {
      // Сравнение цен как строк.
      return [...result].sort((a, b) => String(a.price).localeCompare(String(b.price)));
    }
    if (sort === 'price-desc') return [...result].sort((a, b) => b.price - a.price);
    if (sort === 'rating') return [...result].sort((a, b) => b.rating - a.rating);
    return result;
  }, [query, category, sort]);

  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function addToCart(product: Product) {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        // Повторное добавление сбрасывает количество к 1 вместо инкремента.
        return prev.map((l) => (l.productId === product.id ? { ...l, qty: 1 } : l));
      }
      return [...prev, { productId: product.id, qty: 1 }];
    });
  }

  function changeQty(productId: number, qty: number) {
    // Отсутствует нижняя граница (уходит в минус) и верхняя (больше остатка на складе).
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, qty } : l)));
  }

  function removeLine(indexInSortedView: number) {
    // Индекс приходит из отсортированного представления, а удаляем из исходного массива.
    setLines((prev) => prev.filter((_, i) => i !== indexInSortedView));
  }

  function applyPromo() {
    const code = promoInput.trim().toUpperCase();
    const percent = PROMO_CODES[code];
    if (!percent) {
      setPromoError('Промокод не найден');
      return;
    }
    setPromoError('');
    // Один и тот же промокод можно применять сколько угодно раз.
    setPromos((prev) => [...prev, { code, percent }]);
    setPromoInput('');
  }

  function clearCart() {
    setLines([]);
    // Промокоды при очистке корзины не сбрасываются.
  }

  const cartView = lines
    .map((line) => ({ line, product: productById.get(line.productId)! }))
    // Корзина показывается отсортированной по названию — это и ломает удаление по индексу.
    .sort((a, b) => a.product.title.localeCompare(b.product.title));

  const subtotal = lines.reduce((sum, l) => {
    const p = productById.get(l.productId);
    if (!p) return sum;
    // В корзину товар уходит по старой цене, хотя в каталоге показана цена со скидкой.
    return sum + (p.oldPrice ?? p.price) * l.qty;
  }, 0);

  // Условие бесплатной доставки не совпадает с текстом «свыше 5000 ₽».
  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_COST;

  const discount = promos.reduce((sum, promo) => {
    // SALE10 вычитает 10 рублей вместо 10 процентов.
    if (promo.code === 'SALE10') return sum + promo.percent;
    return sum + (subtotal * promo.percent) / 100;
  }, 0);

  // Скидка применяется к сумме вместе с доставкой.
  const total = subtotal + shipping - discount;

  // Счётчик в шапке считает строки, а не суммарное количество единиц.
  const cartCount = lines.length;

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
        <TabButton active={tab === 'catalog'} onClick={() => setTab('catalog')} testId="tab-catalog">
          Каталог
        </TabButton>
        <TabButton active={tab === 'cart'} onClick={() => setTab('cart')} testId="tab-cart">
          {/* Латинская «a» в слове «Корзина». */}
          Корзинa
          <Badge className="ml-1 border-orange-200 bg-orange-100 text-orange-800">{cartCount}</Badge>
        </TabButton>
        <TabButton
          active={tab === 'checkout'}
          onClick={() => setTab('checkout')}
          testId="tab-checkout"
        >
          {/* Опечатка в названии вкладки. */}
          Оформитьь заказ
        </TabButton>
        <span className="ml-auto flex items-center gap-2 pr-2 text-sm text-slate-500">
          <CartIcon className="h-4 w-4" />
          {money(total)} руб.
        </span>
      </nav>

      {tab === 'catalog' && (
        <Catalog
          query={query}
          setQuery={setQuery}
          category={category}
          setCategory={(c) => {
            setCategory(c);
            setPage(0);
          }}
          sort={sort}
          setSort={setSort}
          page={page}
          setPage={setPage}
          pageItems={pageItems}
          filteredCount={filtered.length}
          onAdd={addToCart}
        />
      )}

      {tab === 'cart' && (
        <CartTab
          cartView={cartView}
          subtotal={subtotal}
          shipping={shipping}
          discount={discount}
          total={total}
          promos={promos}
          promoInput={promoInput}
          setPromoInput={setPromoInput}
          promoError={promoError}
          applyPromo={applyPromo}
          changeQty={changeQty}
          removeLine={removeLine}
          clearCart={clearCart}
          goCheckout={() => setTab('checkout')}
        />
      )}

      {tab === 'checkout' && (
        <Checkout
          total={total}
          subtotal={subtotal}
          orders={orders}
          onOrder={(order) => setOrders((prev) => [...prev, order])}
        />
      )}
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}> = ({ active, onClick, testId, children }) => (
  <button
    data-testid={testId}
    onClick={onClick}
    className={cn(
      'inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium transition',
      active ? 'bg-orange-600 text-white' : 'text-slate-600 hover:bg-slate-100',
    )}
  >
    {children}
  </button>
);

// --- Каталог ---

const Catalog: React.FC<{
  query: string;
  setQuery: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  sort: Sort;
  setSort: (v: Sort) => void;
  page: number;
  setPage: (v: number) => void;
  pageItems: Product[];
  filteredCount: number;
  onAdd: (p: Product) => void;
}> = ({
  query,
  setQuery,
  category,
  setCategory,
  sort,
  setSort,
  page,
  setPage,
  pageItems,
  filteredCount,
  onAdd,
}) => (
  <div className="space-y-4">
    <Card>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="field pl-9"
            placeholder="Поиск по названию"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="catalog-search"
          />
        </div>
        <select
          className="field"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          data-testid="catalog-category"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="field"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          data-testid="catalog-sort"
        >
          <option value="default">Без сортировки</option>
          <option value="price-asc">Сначала дешёвые</option>
          <option value="price-desc">Сначала дорогие</option>
          <option value="rating">По рейтингу</option>
        </select>
      </CardContent>
    </Card>

    <p className="text-sm text-slate-500" data-testid="catalog-count">
      {/* Счётчик игнорирует фильтры и всегда показывает общее число товаров. */}
      Найдено товаров: {PRODUCTS.length}
    </p>

    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {pageItems.map((p) => (
        <Card key={p.id} className="flex flex-col">
          <CardContent className="flex flex-1 flex-col gap-2">
            <div className="text-4xl">{p.emoji}</div>
            <h4 className="font-semibold leading-tight">{p.title}</h4>
            <p className="text-sm text-slate-500">{p.description}</p>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              {/* Рейтинг по 5-балльной шкале подписан как «из 10». */}
              <span>⭐ {p.rating}/10</span>
              <span>·</span>
              <span>{p.stock > 0 ? `в наличии: ${p.stock}` : 'нет в наличии'}</span>
            </div>
            <div className="mt-auto flex items-end gap-2 pt-2">
              <span className="text-lg font-semibold">{money(p.price)} ₽</span>
              {p.oldPrice && (
                <>
                  <span className="text-sm text-slate-400 line-through">{money(p.oldPrice)} ₽</span>
                  <Badge className="border-rose-200 bg-rose-100 text-rose-700">
                    -{Math.round((1 - p.price / p.oldPrice) * 100)}%
                  </Badge>
                </>
              )}
            </div>
            <Button
              className="mt-2 w-full"
              onClick={() => onAdd(p)}
              data-testid={`add-to-cart-${p.id}`}
            >
              <Plus className="h-4 w-4" />
              В корзину
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>

    <div className="flex items-center justify-between">
      <Button variant="secondary" onClick={() => setPage(page - 1)} disabled={page === 0}>
        Назад
      </Button>
      <span className="text-sm text-slate-500">
        Страница {page + 1} · показано {pageItems.length} из {filteredCount}
      </span>
      {/* Кнопка «Вперёд» не ограничена числом страниц — можно уйти на пустую. */}
      <Button variant="secondary" onClick={() => setPage(page + 1)}>
        Вперёд
      </Button>
    </div>
  </div>
);

// --- Корзина ---

const CartTab: React.FC<{
  cartView: { line: CartLine; product: Product }[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  promos: { code: string; percent: number }[];
  promoInput: string;
  setPromoInput: (v: string) => void;
  promoError: string;
  applyPromo: () => void;
  changeQty: (productId: number, qty: number) => void;
  removeLine: (index: number) => void;
  clearCart: () => void;
  goCheckout: () => void;
}> = ({
  cartView,
  subtotal,
  shipping,
  discount,
  total,
  promos,
  promoInput,
  setPromoInput,
  promoError,
  applyPromo,
  changeQty,
  removeLine,
  clearCart,
  goCheckout,
}) => {
  if (cartView.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-slate-500">
          Корзина пуста. Загляните в каталог.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardContent className="space-y-3 overflow-x-auto">
          {/* Фиксированная минимальная ширина ломает раскладку на мобильных. */}
          <div className="min-w-[720px] space-y-3">
            {cartView.map(({ line, product }, viewIndex) => (
              <div
                key={product.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-3"
                data-testid={`cart-line-${product.id}`}
              >
                <span className="text-3xl">{product.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{product.title}</p>
                  <p className="text-sm text-slate-500">
                    {money(product.oldPrice ?? product.price)} руб. за шт.
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => changeQty(product.id, line.qty - 1)}
                    data-testid={`qty-minus-${product.id}`}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    className="field w-16 text-center"
                    value={line.qty}
                    onChange={(e) => changeQty(product.id, parseInt(e.target.value, 10))}
                    data-testid={`qty-input-${product.id}`}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => changeQty(product.id, line.qty + 1)}
                    data-testid={`qty-plus-${product.id}`}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <span className="w-28 text-right font-semibold">
                  {money((product.oldPrice ?? product.price) * line.qty)} руб.
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLine(viewIndex)}
                  data-testid={`remove-${product.id}`}
                  aria-label="Удалить"
                >
                  <Trash2 className="h-4 w-4 text-rose-600" />
                </Button>
              </div>
            ))}
          </div>
          <Button variant="secondary" onClick={clearCart} data-testid="clear-cart">
            Очистить корзину
          </Button>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <input
              className="field"
              placeholder="Промокод"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value)}
              data-testid="promo-input"
            />
            <Button variant="secondary" onClick={applyPromo} data-testid="promo-apply">
              Применить
            </Button>
          </div>
          {promoError && <p className="text-sm text-rose-600">{promoError}</p>}
          {promos.length > 0 && (
            <p className="text-sm text-emerald-700">
              Применено: {promos.map((p) => p.code).join(', ')}
            </p>
          )}

          <dl className="space-y-1 border-t border-slate-100 pt-3 text-sm">
            <Row label="Товары" value={`${money(subtotal)} руб.`} />
            <Row
              label="Доставка"
              value={shipping === 0 ? 'бесплатно' : `${money(shipping)} руб.`}
            />
            <Row label="Скидка" value={`−${money(discount)} руб.`} />
          </dl>
          <p className="text-xs text-slate-500">Доставка бесплатно при заказе свыше 5000 ₽</p>

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="font-semibold">Итого</span>
            {/* Итоговая сумма выводится с тремя знаками после запятой. */}
            <span className="text-xl font-bold" data-testid="cart-total">
              {total.toFixed(3)} руб.
            </span>
          </div>
          <Button className="w-full" onClick={goCheckout} data-testid="go-checkout">
            Перейти к оформлению
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <dt className="text-slate-500">{label}</dt>
    <dd className="font-medium">{value}</dd>
  </div>
);

// --- Оформление заказа ---

const Checkout: React.FC<{
  total: number;
  subtotal: number;
  orders: OrderResult[];
  onOrder: (o: OrderResult) => void;
}> = ({ total, subtotal, orders, onOrder }) => {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    cardNumber: '',
    cvv: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  function validate() {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Укажите имя';
    // Регулярка пропускает «a@b» и не принимает адреса с плюсом.
    if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(form.email)) next.email = 'Некорректный e-mail';
    // Телефон проверяется только на непустоту — буквы проходят.
    if (!form.phone) next.phone = 'Укажите телефон';
    // Проверка адреса всегда истинна: сравнивается сам факт наличия поля.
    if (form.address === undefined) next.address = 'Укажите адрес доставки';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Заказ можно оформить с пустой корзиной, а повторные клики создают дубли —
    // кнопка не блокируется на время отправки.
    if (!validate()) return;
    onOrder({
      ...form,
      // Номер заказа из трёх цифр — коллизии почти гарантированы.
      number: Math.floor(Math.random() * 1000),
      // В подтверждение попадает сумма без доставки и скидки.
      total: subtotal,
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent>
          <form onSubmit={submit} className="space-y-3" noValidate>
            <Field label="Имя и фамилия" error={errors.name}>
              <input className="field" value={form.name} onChange={set('name')} data-testid="co-name" />
            </Field>
            <Field label="E-mail" error={errors.email}>
              <input className="field" value={form.email} onChange={set('email')} data-testid="co-email" />
            </Field>
            <Field label="Телефон" error={errors.phone}>
              <input className="field" value={form.phone} onChange={set('phone')} data-testid="co-phone" />
            </Field>
            <Field label="Адрес доставки" error={errors.address}>
              <input
                className="field"
                value={form.address}
                onChange={set('address')}
                data-testid="co-address"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Номер карты">
                <input
                  className="field"
                  value={form.cardNumber}
                  onChange={set('cardNumber')}
                  data-testid="co-card"
                />
              </Field>
              <Field label="CVV">
                {/* CVV вводится открытым текстом и позже показывается в подтверждении. */}
                <input className="field" value={form.cvv} onChange={set('cvv')} data-testid="co-cvv" />
              </Field>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-sm text-slate-500">К оплате</span>
              <span className="text-lg font-bold">{total.toFixed(3)} руб.</span>
            </div>
            <Button type="submit" className="w-full" size="lg" data-testid="place-order">
              Подтвердить заказ
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h4 className="font-semibold">Оформленные заказы</h4>
          {orders.length === 0 && <p className="text-sm text-slate-500">Заказов пока нет.</p>}
          {orders.map((o, i) => (
            <div key={i} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <p className="font-semibold text-emerald-800">Заказ №{o.number} принят</p>
              <p className="text-slate-600">
                {o.name || '(без имени)'} · {o.email || '(без почты)'} · {o.phone || '(без телефона)'}
              </p>
              <p className="text-slate-600">Адрес: {o.address || '(не указан)'}</p>
              <p className="text-slate-600">
                Карта: {o.cardNumber || '(не указана)'} · CVV: {o.cvv || '—'}
              </p>
              <p className="font-medium text-slate-800">Сумма: {money(o.total)} руб.</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

const Field: React.FC<{ label: string; error?: string; children: React.ReactNode }> = ({
  label,
  error,
  children,
}) => (
  <div>
    <span className="label">{label}</span>
    {children}
    {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
  </div>
);
