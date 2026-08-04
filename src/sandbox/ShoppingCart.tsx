import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  CreditCard,
  Heart,
  Minus,
  Package,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { Modal, cn } from '@/components/ui';
import {
  CATEGORIES,
  FREE_SHIPPING_THRESHOLD,
  PRODUCTS,
  PROMO_CODES,
  SHIPPING_COST,
  type Product,
} from './products';

/**
 * Тренажёр «ТехноМаркет» — витрина интернет-магазина.
 *
 * Внимание для мейнтейнеров: дефекты в этом файле внесены НАМЕРЕННО — это предмет
 * поиска для участников конкурса. Полный перечень лежит в src/lib/knownBugs.ts
 * и подгружается только в админке. Не «чините» тут ничего без сверки с этим списком.
 */

type CartLine = { productId: number; qty: number };
type View = 'catalog' | 'cart' | 'checkout';
type Sort = 'default' | 'price-asc' | 'price-desc' | 'rating';

interface OrderResult {
  number: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  cardNumber: string;
  cvv: string;
  delivery: string;
  total: number;
}

const PAGE_SIZE = 6;

const money = (value: number) => value.toLocaleString('ru-RU');

export const ShoppingCartApp: React.FC = () => {
  const [view, setView] = useState<View>('catalog');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [sort, setSort] = useState<Sort>('default');
  const [page, setPage] = useState(0);
  const [promoInput, setPromoInput] = useState('');
  const [promos, setPromos] = useState<{ code: string; percent: number }[]>([]);
  const [promoError, setPromoError] = useState('');
  const [orders, setOrders] = useState<OrderResult[]>([]);
  const [quickView, setQuickView] = useState<Product | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);

  // Название предыдущего добавленного товара — источник дефекта в уведомлении.
  const previousAdded = useRef<string>('');

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

  function notify(text: string) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }

  function addToCart(product: Product) {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        // Повторное добавление сбрасывает количество к 1 вместо инкремента.
        return prev.map((l) => (l.productId === product.id ? { ...l, qty: 1 } : l));
      }
      return [...prev, { productId: product.id, qty: 1 }];
    });
    // Уведомление показывает название предыдущего добавленного товара.
    notify(`«${previousAdded.current || product.title}» в корзине`);
    previousAdded.current = product.title;
  }

  function toggleFavorite(productId: number) {
    // Повторный клик не снимает отметку, а добавляет ещё одну запись — счётчик растёт.
    setFavorites((prev) => [...prev, productId]);
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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <StoreHeader
        view={view}
        setView={setView}
        query={query}
        setQuery={(v) => {
          setQuery(v);
          setPage(0);
        }}
        cartCount={cartCount}
        favoritesCount={favorites.length}
        total={total}
      />

      <div className="bg-slate-50/70 px-4 py-6 sm:px-6">
        {view === 'catalog' && (
          <Catalog
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
            favorites={favorites}
            onAdd={addToCart}
            onToggleFavorite={toggleFavorite}
            onQuickView={setQuickView}
          />
        )}

        {view === 'cart' && (
          <CartView
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
            goCatalog={() => setView('catalog')}
            goCheckout={() => setView('checkout')}
          />
        )}

        {view === 'checkout' && (
          <Checkout
            total={total}
            subtotal={subtotal}
            shipping={shipping}
            discount={discount}
            itemsCount={cartCount}
            orders={orders}
            onOrder={(order) => setOrders((prev) => [...prev, order])}
          />
        )}
      </div>

      <StoreFooter />

      <QuickView
        product={quickView}
        onClose={() => setQuickView(null)}
        onAdd={(p) => {
          addToCart(p);
          setQuickView(null);
        }}
      />

      <div className="pointer-events-none fixed bottom-4 right-4 z-40 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm shadow-lg"
            data-testid="toast"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Check className="h-3.5 w-3.5" />
            </span>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Шапка магазина ---

const StoreHeader: React.FC<{
  view: View;
  setView: (v: View) => void;
  query: string;
  setQuery: (v: string) => void;
  cartCount: number;
  favoritesCount: number;
  total: number;
}> = ({ view, setView, query, setQuery, cartCount, favoritesCount, total }) => (
  <header className="border-b border-slate-200 bg-white">
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
      <button
        className="flex items-center gap-2"
        onClick={() => setView('catalog')}
        data-testid="store-logo"
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-sm">
          <ShoppingBag className="h-5 w-5" />
        </span>
        <span className="text-lg font-bold tracking-tight">
          Техно<span className="text-orange-600">Маркет</span>
        </span>
      </button>

      <div className="relative order-last w-full sm:order-none sm:w-auto sm:flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="field pl-9"
          placeholder="Искать товары"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="catalog-search"
        />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <span
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600"
          title="Избранное"
          data-testid="favorites-count"
        >
          <Heart className="h-5 w-5" />
          {favoritesCount > 0 && (
            <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-4 text-white">
              {favoritesCount}
            </span>
          )}
        </span>

        <button
          onClick={() => setView('cart')}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          data-testid="tab-cart"
        >
          <span className="relative">
            <ShoppingBag className="h-5 w-5" />
            {cartCount > 0 && (
              <span className="absolute -right-2 -top-2 min-w-[16px] rounded-full bg-orange-600 px-1 text-[10px] font-bold leading-4 text-white">
                {cartCount}
              </span>
            )}
          </span>
          <span className="hidden sm:inline">{money(total)} руб.</span>
        </button>
      </div>
    </div>

    <nav className="flex items-center gap-1 border-t border-slate-100 px-4 sm:px-6">
      <NavTab active={view === 'catalog'} onClick={() => setView('catalog')} testId="tab-catalog">
        Каталог
      </NavTab>
      {/* Латинская «a» в слове «Корзина». */}
      <NavTab active={view === 'cart'} onClick={() => setView('cart')} testId="tab-cart-nav">
        Корзинa
      </NavTab>
      {/* Опечатка в названии вкладки. */}
      <NavTab
        active={view === 'checkout'}
        onClick={() => setView('checkout')}
        testId="tab-checkout"
      >
        Оформитьь заказ
      </NavTab>
    </nav>
  </header>
);

const NavTab: React.FC<{
  active: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}> = ({ active, onClick, testId, children }) => (
  <button
    data-testid={testId}
    onClick={onClick}
    className={cn(
      '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition',
      active
        ? 'border-orange-600 text-orange-700'
        : 'border-transparent text-slate-500 hover:text-slate-800',
    )}
  >
    {children}
  </button>
);

// --- Каталог ---

const Catalog: React.FC<{
  category: string;
  setCategory: (v: string) => void;
  sort: Sort;
  setSort: (v: Sort) => void;
  page: number;
  setPage: (v: number) => void;
  pageItems: Product[];
  filteredCount: number;
  favorites: number[];
  onAdd: (p: Product) => void;
  onToggleFavorite: (id: number) => void;
  onQuickView: (p: Product) => void;
}> = ({
  category,
  setCategory,
  sort,
  setSort,
  page,
  setPage,
  pageItems,
  filteredCount,
  favorites,
  onAdd,
  onToggleFavorite,
  onQuickView,
}) => (
  <div className="space-y-5">
    <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-orange-900 px-6 py-8 text-white sm:px-10 sm:py-10">
      <p className="text-xs uppercase tracking-widest text-orange-300">Летняя распродажа</p>
      <h2 className="mt-2 max-w-lg text-2xl font-bold leading-tight sm:text-3xl">
        Скидки до 25% на технику для дома и работы
      </h2>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <span className="rounded-lg bg-white/10 px-3 py-1.5 backdrop-blur">
          Промокод <b className="font-mono">SALE10</b> — минус 10%
        </span>
        <span className="rounded-lg bg-white/10 px-3 py-1.5 backdrop-blur">
          Промокод <b className="font-mono">QA2026</b> — минус 15%
        </span>
      </div>
    </section>

    <div className="grid gap-3 sm:grid-cols-3">
      <Advantage icon={<Truck className="h-4 w-4" />} title="Бесплатная доставка">
        при заказе свыше 5000 ₽
      </Advantage>
      <Advantage icon={<ShieldCheck className="h-4 w-4" />} title="Гарантия 2 года">
        на всю технику
      </Advantage>
      <Advantage icon={<RotateCcw className="h-4 w-4" />} title="Возврат 14 дней">
        без объяснения причин
      </Advantage>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      {CATEGORIES.map((c) => (
        <button
          key={c}
          onClick={() => setCategory(c)}
          className={cn(
            'rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
            category === c
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
          )}
          data-testid={`category-${c}`}
        >
          {c}
        </button>
      ))}
      <select
        className="field ml-auto w-auto"
        value={sort}
        onChange={(e) => setSort(e.target.value as Sort)}
        data-testid="catalog-sort"
      >
        <option value="default">Сортировка: по умолчанию</option>
        <option value="price-asc">Сначала дешёвые</option>
        <option value="price-desc">Сначала дорогие</option>
        <option value="rating">По рейтингу</option>
      </select>
    </div>

    <p className="text-sm text-slate-500" data-testid="catalog-count">
      {/* Счётчик игнорирует фильтры и всегда показывает общее число товаров. */}
      Найдено товаров: {PRODUCTS.length}
    </p>

    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {pageItems.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          favorite={favorites.includes(p.id)}
          onAdd={onAdd}
          onToggleFavorite={onToggleFavorite}
          onQuickView={onQuickView}
        />
      ))}
    </div>

    {pageItems.length === 0 && (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
        <p className="text-slate-500">Товары не найдены</p>
      </div>
    )}

    <div className="flex items-center justify-between">
      <button
        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
        onClick={() => setPage(page - 1)}
        disabled={page === 0}
      >
        Назад
      </button>
      <span className="text-sm text-slate-500">
        Страница {page + 1} · показано {pageItems.length} из {filteredCount}
      </span>
      {/* Кнопка «Вперёд» не ограничена числом страниц — можно уйти на пустую. */}
      <button
        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        onClick={() => setPage(page + 1)}
      >
        Вперёд
      </button>
    </div>
  </div>
);

const Advantage: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({
  icon,
  title,
  children,
}) => (
  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
      {icon}
    </span>
    <div className="min-w-0 text-sm leading-tight">
      <p className="font-semibold">{title}</p>
      <p className="text-slate-500">{children}</p>
    </div>
  </div>
);

const Stars: React.FC<{ rating: number }> = ({ rating }) => (
  <span className="inline-flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((i) => (
      <Star
        key={i}
        className={cn(
          'h-3.5 w-3.5',
          i <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-slate-300',
        )}
      />
    ))}
  </span>
);

const ProductCard: React.FC<{
  product: Product;
  favorite: boolean;
  onAdd: (p: Product) => void;
  onToggleFavorite: (id: number) => void;
  onQuickView: (p: Product) => void;
}> = ({ product: p, favorite, onAdd, onToggleFavorite, onQuickView }) => (
  <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:shadow-lg">
    <div className={cn('relative flex h-44 items-center justify-center bg-gradient-to-br', p.gradient)}>
      <span className="text-6xl drop-shadow-sm transition group-hover:scale-110">{p.emoji}</span>

      <div className="absolute left-3 top-3 flex flex-col gap-1.5">
        {p.oldPrice && (
          <span className="rounded-lg bg-rose-600 px-2 py-1 text-xs font-bold text-white shadow-sm">
            −{Math.round((1 - p.price / p.oldPrice) * 100)}%
          </span>
        )}
        {p.badge && (
          <span className="rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur">
            {p.badge}
          </span>
        )}
      </div>

      <button
        onClick={() => onToggleFavorite(p.id)}
        className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:text-rose-600"
        aria-label="В избранное"
        data-testid={`favorite-${p.id}`}
      >
        <Heart className={cn('h-4 w-4', favorite && 'fill-rose-500 text-rose-500')} />
      </button>

      <button
        onClick={() => onQuickView(p)}
        className="absolute inset-x-3 bottom-3 rounded-lg bg-white/95 py-2 text-xs font-semibold text-slate-800 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100"
        data-testid={`quick-view-${p.id}`}
      >
        Быстрый просмотр
      </button>
    </div>

    <div className="flex flex-1 flex-col gap-2 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{p.category}</p>
      <h4 className="font-semibold leading-tight">{p.title}</h4>

      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <Stars rating={p.rating} />
        {/* Рейтинг по 5-балльной шкале подписан как «из 10». */}
        <span className="font-medium text-slate-700">{p.rating}/10</span>
        <span>· {p.reviews} отзывов</span>
      </div>

      <p className="line-clamp-2 text-sm text-slate-500">{p.description}</p>

      <p className={cn('text-xs font-medium', p.stock > 0 ? 'text-emerald-600' : 'text-rose-600')}>
        {p.stock > 0 ? `В наличии: ${p.stock} шт.` : 'Нет в наличии'}
      </p>

      <div className="mt-auto flex items-end gap-2 pt-2">
        <span className="text-xl font-bold">{money(p.price)} ₽</span>
        {p.oldPrice && (
          <span className="pb-0.5 text-sm text-slate-400 line-through">{money(p.oldPrice)} ₽</span>
        )}
      </div>

      <button
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-700"
        onClick={() => onAdd(p)}
        data-testid={`add-to-cart-${p.id}`}
      >
        <Plus className="h-4 w-4" />В корзину
      </button>
    </div>
  </article>
);

const QuickView: React.FC<{
  product: Product | null;
  onClose: () => void;
  onAdd: (p: Product) => void;
}> = ({ product, onClose, onAdd }) => (
  <Modal open={product !== null} onClose={onClose} title="Быстрый просмотр" wide>
    {product && (
      <div className="grid gap-5 sm:grid-cols-2">
        <div
          className={cn(
            'flex h-56 items-center justify-center rounded-xl bg-gradient-to-br',
            product.gradient,
          )}
        >
          <span className="text-7xl">{product.emoji}</span>
        </div>
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">{product.category}</p>
          <h3 className="text-xl font-bold leading-tight">{product.title}</h3>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Stars rating={product.rating} />
            <span>· {product.reviews} отзывов</span>
          </div>
          <p className="text-sm text-slate-600">{product.description}</p>

          <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {product.specs.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-3 py-2 text-sm">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold">{money(product.price)} ₽</span>
            {product.oldPrice && (
              <span className="pb-1 text-sm text-slate-400 line-through">
                {money(product.oldPrice)} ₽
              </span>
            )}
          </div>
          {/* Быстрый просмотр всегда сообщает о наличии, даже если остаток нулевой. */}
          <p className="text-xs font-medium text-emerald-600">Товар в наличии</p>

          <button
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-700"
            onClick={() => onAdd(product)}
            data-testid="quick-view-add"
          >
            <Plus className="h-4 w-4" />В корзину
          </button>
        </div>
      </div>
    )}
  </Modal>
);

// --- Корзина ---

const CartView: React.FC<{
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
  goCatalog: () => void;
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
  goCatalog,
  goCheckout,
}) => {
  if (cartView.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
        <span className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <ShoppingBag className="h-7 w-7" />
        </span>
        <p className="font-semibold">В корзине пока пусто</p>
        <p className="mt-1 text-sm text-slate-500">Загляните в каталог — там есть что выбрать.</p>
        <button
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-700"
          onClick={goCatalog}
        >
          Перейти в каталог
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4">
          {/* Фиксированная минимальная ширина ломает раскладку на мобильных. */}
          <div className="min-w-[720px] divide-y divide-slate-100">
            {cartView.map(({ line, product }, viewIndex) => (
              <div
                key={product.id}
                className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                data-testid={`cart-line-${product.id}`}
              >
                <span
                  className={cn(
                    'flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-3xl',
                    product.gradient,
                  )}
                >
                  {product.emoji}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{product.title}</p>
                  <p className="text-sm text-slate-500">
                    {money(product.oldPrice ?? product.price)} руб. за шт.
                  </p>
                </div>

                <div className="flex items-center rounded-lg border border-slate-200">
                  <button
                    className="px-2.5 py-2 text-slate-600 transition hover:bg-slate-50"
                    onClick={() => changeQty(product.id, line.qty - 1)}
                    data-testid={`qty-minus-${product.id}`}
                    aria-label="Уменьшить"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    className="w-12 border-x border-slate-200 py-2 text-center text-sm outline-none"
                    value={line.qty}
                    onChange={(e) => changeQty(product.id, parseInt(e.target.value, 10))}
                    data-testid={`qty-input-${product.id}`}
                  />
                  <button
                    className="px-2.5 py-2 text-slate-600 transition hover:bg-slate-50"
                    onClick={() => changeQty(product.id, line.qty + 1)}
                    data-testid={`qty-plus-${product.id}`}
                    aria-label="Увеличить"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <span className="w-32 text-right font-semibold">
                  {money((product.oldPrice ?? product.price) * line.qty)} руб.
                </span>

                <button
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  onClick={() => removeLine(viewIndex)}
                  data-testid={`remove-${product.id}`}
                  aria-label="Удалить"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            onClick={goCatalog}
          >
            Продолжить покупки
          </button>
          <button
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            onClick={clearCart}
            data-testid="clear-cart"
          >
            Очистить корзину
          </button>
        </div>
      </div>

      <div className="h-fit space-y-3 rounded-2xl border border-slate-200 bg-white p-4 lg:sticky lg:top-4">
        <h3 className="font-semibold">Ваш заказ</h3>

        <div className="flex gap-2">
          <input
            className="field"
            placeholder="Промокод"
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value)}
            data-testid="promo-input"
          />
          <button
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            onClick={applyPromo}
            data-testid="promo-apply"
          >
            Применить
          </button>
        </div>
        {promoError && <p className="text-sm text-rose-600">{promoError}</p>}
        {promos.length > 0 && (
          <p className="flex flex-wrap gap-1 text-xs">
            {promos.map((p, i) => (
              <span
                key={i}
                className="rounded-md bg-emerald-50 px-2 py-1 font-mono font-medium text-emerald-700"
              >
                {p.code}
              </span>
            ))}
          </p>
        )}

        <dl className="space-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <SummaryRow label="Товары" value={`${money(subtotal)} руб.`} />
          <SummaryRow
            label="Доставка"
            value={shipping === 0 ? 'бесплатно' : `${money(shipping)} руб.`}
          />
          <SummaryRow label="Скидка" value={`−${money(discount)} руб.`} />
        </dl>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Доставка бесплатно при заказе свыше 5000 ₽
        </p>

        <div className="flex items-baseline justify-between border-t border-slate-100 pt-3">
          <span className="font-semibold">Итого</span>
          {/* Итоговая сумма выводится с тремя знаками после запятой. */}
          <span className="text-2xl font-bold" data-testid="cart-total">
            {total.toFixed(3)} руб.
          </span>
        </div>

        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-700"
          onClick={goCheckout}
          data-testid="go-checkout"
        >
          Перейти к оформлению
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

const SummaryRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <dt className="text-slate-500">{label}</dt>
    <dd className="font-medium">{value}</dd>
  </div>
);

// --- Оформление заказа ---

const DELIVERY_OPTIONS = [
  { id: 'courier', title: 'Курьером', note: 'завтра, с 10:00 до 22:00' },
  { id: 'pickup', title: 'Самовывоз', note: 'сегодня, 12 пунктов выдачи' },
  { id: 'post', title: 'Почтой', note: '3–7 дней' },
];

const Checkout: React.FC<{
  total: number;
  subtotal: number;
  shipping: number;
  discount: number;
  itemsCount: number;
  orders: OrderResult[];
  onOrder: (o: OrderResult) => void;
}> = ({ total, subtotal, shipping, discount, itemsCount, orders, onOrder }) => {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    cardNumber: '',
    cvv: '',
  });
  const [delivery, setDelivery] = useState('courier');
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
      delivery: DELIVERY_OPTIONS.find((d) => d.id === delivery)?.title ?? '',
      // Номер заказа из трёх цифр — коллизии почти гарантированы.
      number: Math.floor(Math.random() * 1000),
      // В подтверждение попадает сумма без доставки и скидки.
      total: subtotal,
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <form onSubmit={submit} className="space-y-4 lg:col-span-2" noValidate>
        <Section step={1} title="Контактные данные">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Имя и фамилия" error={errors.name}>
              <input className="field" value={form.name} onChange={set('name')} data-testid="co-name" />
            </Field>
            <Field label="Телефон" error={errors.phone}>
              <input
                className="field"
                value={form.phone}
                onChange={set('phone')}
                placeholder="+7 900 000-00-00"
                data-testid="co-phone"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="E-mail" error={errors.email}>
                <input
                  className="field"
                  value={form.email}
                  onChange={set('email')}
                  placeholder="name@company.ru"
                  data-testid="co-email"
                />
              </Field>
            </div>
          </div>
        </Section>

        <Section step={2} title="Доставка">
          <div className="grid gap-2 sm:grid-cols-3">
            {DELIVERY_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setDelivery(o.id)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left transition',
                  delivery === o.id
                    ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-200'
                    : 'border-slate-200 bg-white hover:border-slate-300',
                )}
                data-testid={`delivery-${o.id}`}
              >
                <p className="text-sm font-semibold">{o.title}</p>
                <p className="text-xs text-slate-500">{o.note}</p>
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Field label="Адрес доставки" error={errors.address}>
              <input
                className="field"
                value={form.address}
                onChange={set('address')}
                placeholder="Город, улица, дом, квартира"
                data-testid="co-address"
              />
            </Field>
          </div>
        </Section>

        <Section step={3} title="Оплата">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Номер карты">
              <input
                className="field"
                value={form.cardNumber}
                onChange={set('cardNumber')}
                placeholder="0000 0000 0000 0000"
                data-testid="co-card"
              />
            </Field>
            <Field label="CVV">
              {/* CVV вводится открытым текстом и позже показывается в подтверждении. */}
              <input className="field" value={form.cvv} onChange={set('cvv')} data-testid="co-cvv" />
            </Field>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            <CreditCard className="h-3.5 w-3.5" />
            Данные карты передаются по защищённому соединению
          </p>
        </Section>

        {orders.length > 0 && (
          <Section step={4} title="Оформленные заказы">
            <div className="space-y-2">
              {orders.map((o, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm"
                  data-testid="order-card"
                >
                  <p className="flex items-center gap-2 font-semibold text-emerald-800">
                    <Package className="h-4 w-4" />
                    Заказ №{o.number} принят
                  </p>
                  <p className="mt-1 text-slate-600">
                    {o.name || '(без имени)'} · {o.email || '(без почты)'} ·{' '}
                    {o.phone || '(без телефона)'}
                  </p>
                  <p className="text-slate-600">
                    {o.delivery} · {o.address || 'адрес не указан'}
                  </p>
                  <p className="text-slate-600">
                    Карта: {o.cardNumber || '(не указана)'} · CVV: {o.cvv || '—'}
                  </p>
                  <p className="font-medium text-slate-800">Сумма: {money(o.total)} руб.</p>
                </div>
              ))}
            </div>
          </Section>
        )}
      </form>

      <div className="h-fit space-y-3 rounded-2xl border border-slate-200 bg-white p-4 lg:sticky lg:top-4">
        <h3 className="font-semibold">Итого по заказу</h3>
        <dl className="space-y-1.5 text-sm">
          <SummaryRow label="Товаров, поз." value={String(itemsCount)} />
          <SummaryRow label="Товары" value={`${money(subtotal)} руб.`} />
          <SummaryRow
            label="Доставка"
            value={shipping === 0 ? 'бесплатно' : `${money(shipping)} руб.`}
          />
          <SummaryRow label="Скидка" value={`−${money(discount)} руб.`} />
        </dl>
        <div className="flex items-baseline justify-between border-t border-slate-100 pt-3">
          <span className="font-semibold">К оплате</span>
          <span className="text-2xl font-bold">{total.toFixed(3)} руб.</span>
        </div>
        <button
          type="submit"
          onClick={submit}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-700"
          data-testid="place-order"
        >
          Подтвердить заказ
        </button>
        <p className="text-center text-xs text-slate-400">
          Нажимая кнопку, вы соглашаетесь с условиями обработки данных
        </p>
      </div>
    </div>
  );
};

const Section: React.FC<{ step: number; title: string; children: React.ReactNode }> = ({
  step,
  title,
  children,
}) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4">
    <h3 className="mb-3 flex items-center gap-2 font-semibold">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs text-white">
        {step}
      </span>
      {title}
    </h3>
    {children}
  </section>
);

const Field: React.FC<{ label: string; error?: string; children: React.ReactNode }> = ({
  label,
  error,
  children,
}) => (
  <div>
    <span className="label">{label}</span>
    {children}
    {error && (
      <p className="mt-1 flex items-center gap-1 text-xs text-rose-600">
        <X className="h-3 w-3" />
        {error}
      </p>
    )}
  </div>
);

const StoreFooter: React.FC = () => (
  <footer className="border-t border-slate-200 bg-white px-4 py-5 text-xs text-slate-400 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span>© 2026 ТехноМаркет — интернет-магазин электроники</span>
      <span className="flex gap-4">
        <span>Доставка и оплата</span>
        <span>Гарантия</span>
        <span>Контакты</span>
      </span>
    </div>
  </footer>
);
