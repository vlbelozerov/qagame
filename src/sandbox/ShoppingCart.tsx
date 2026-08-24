import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
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
import { HONEYPOT_CODES } from '@/lib/honeypot';
import {
  CATEGORIES,
  FREE_SHIPPING_THRESHOLD,
  PRODUCTS,
  PROMO_CODES,
  SHIPPING_COST,
  type Product,
} from './products';

/**
 * Тренажёр «СпортАрена» — витрина магазина спортивных товаров.
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

export const ShoppingCartApp: React.FC<{
  /** Витрина закрыта оверлеем: показываем промокоды-приманки вместо настоящих. */
  preview?: boolean;
}> = ({ preview = false }) => {
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
        // Категория «Тренажёры» подмешивает аксессуары.
        (category === 'Тренажёры' && p.category === 'Аксессуары');
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
    <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
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

      <div className="bg-slate-50 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {view === 'catalog' && (
          <Catalog
            preview={preview}
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
            className="pointer-events-auto flex items-center gap-2.5 rounded-2xl bg-white px-4 py-3 text-sm shadow-[0_16px_40px_-16px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/5"
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
  <header className="border-b border-slate-200 bg-white/95 backdrop-blur">
    <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-6">
      <button
        className="flex items-center gap-2.5"
        onClick={() => setView('catalog')}
        data-testid="store-logo"
      >
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-lg shadow-orange-500/25">
          <ShoppingBag className="h-5 w-5" />
        </span>
        <span className="text-lg font-bold tracking-tight">
          Спорт<span className="text-orange-600">Арена</span>
        </span>
      </button>

      <div className="relative order-last w-full sm:order-none sm:w-auto sm:flex-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="field rounded-full border-transparent bg-slate-100 pl-10 focus:bg-white"
          placeholder="Искать товары для спорта"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="catalog-search"
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <span
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-rose-600"
          title="Избранное"
          data-testid="favorites-count"
        >
          <Heart className="h-5 w-5" />
          {favoritesCount > 0 && (
            <span className="absolute right-0.5 top-0.5 min-w-[17px] rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-[17px] text-white ring-2 ring-white">
              {favoritesCount}
            </span>
          )}
        </span>

        <button
          onClick={() => setView('cart')}
          className="flex items-center gap-2.5 rounded-full bg-slate-900 py-2 pl-3 pr-4 text-sm font-semibold text-white transition hover:bg-slate-800"
          data-testid="tab-cart"
        >
          <span className="relative">
            <ShoppingBag className="h-5 w-5" />
            {cartCount > 0 && (
              <span className="absolute -right-2 -top-2 min-w-[17px] rounded-full bg-orange-500 px-1 text-[10px] font-bold leading-[17px] text-white ring-2 ring-slate-900">
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
  preview: boolean;
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
  preview,
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
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-orange-950 px-6 py-10 text-white shadow-xl shadow-slate-900/10 sm:px-10 sm:py-12">
      {/* Два световых пятна вместо плоской заливки — баннер получает глубину. */}
      <span
        className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-orange-500/25 blur-3xl"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-rose-500/15 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative">
      <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-200 ring-1 ring-inset ring-white/15">
        Сезон тренировок
      </p>
      <h2 className="mt-3 max-w-xl text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl">
        Скидки до 25% на экипировку и домашние тренажёры
      </h2>
      <div className="mt-5 flex flex-wrap gap-2 text-sm">
        {/*
          Пока витрина закрыта, показываем коды-приманки: настоящих их не существует,
          и увидеть их можно только сняв оверлей через инструменты разработчика.
        */}
        <span className="rounded-full bg-white/10 px-4 py-2 ring-1 ring-inset ring-white/15 backdrop-blur">
          Промокод <b className="font-mono tracking-wide">{preview ? HONEYPOT_CODES[0] : 'SALE10'}</b> — минус 10%
        </span>
        <span className="rounded-full bg-white/10 px-4 py-2 ring-1 ring-inset ring-white/15 backdrop-blur">
          Промокод <b className="font-mono tracking-wide">{preview ? HONEYPOT_CODES[1] : 'QA2026'}</b> — минус 15%
        </span>
      </div>
      </div>
    </section>

    <div className="grid gap-3 sm:grid-cols-3">
      <Advantage icon={<Truck className="h-4 w-4" />} title="Бесплатная доставка">
        при заказе свыше 5000 ₽
      </Advantage>
      <Advantage icon={<ShieldCheck className="h-4 w-4" />} title="Гарантия 2 года">
        на тренажёры
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
            'rounded-full px-4 py-2 text-sm font-medium transition',
            category === c
              ? 'bg-slate-900 text-white shadow-sm shadow-slate-900/20'
              : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:text-slate-900 hover:ring-slate-300',
          )}
          data-testid={`category-${c}`}
        >
          {c}
        </button>
      ))}
      {/* Нативный select выдаёт себя системной стрелкой — рисуем свою. */}
      <div className="relative ml-auto">
        <select
          className="field w-auto appearance-none rounded-full border-transparent bg-white py-2 pl-4 pr-10 font-medium ring-1 ring-inset ring-slate-200"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          data-testid="catalog-sort"
        >
          <option value="default">Сортировка: по умолчанию</option>
          <option value="price-asc">Сначала дешёвые</option>
          <option value="price-desc">Сначала дорогие</option>
          <option value="rating">По рейтингу</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
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

    <div className="flex items-center justify-between pt-1">
      <button
        className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:ring-slate-300 disabled:opacity-40 disabled:hover:ring-slate-200"
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
        className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:ring-slate-300"
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
  <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5 transition hover:border-slate-300">
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-50 to-rose-50 text-orange-600 ring-1 ring-inset ring-orange-100">
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
  <article className="group flex flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-[0_18px_40px_-18px_rgba(15,23,42,0.35)]">
    <div className={cn('relative flex h-52 items-center justify-center bg-gradient-to-br p-4', p.gradient)}>
      {/* Мягкое пятно света под товаром: подложка перестаёт выглядеть плоской заливкой. */}
      <span className="absolute h-32 w-32 rounded-full bg-white/70 blur-2xl" aria-hidden="true" />
      <span className="relative text-[72px] leading-none drop-shadow-[0_8px_16px_rgba(15,23,42,0.18)] transition duration-300 group-hover:-translate-y-1 group-hover:scale-105">
        {p.emoji}
      </span>

      <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
        {p.oldPrice && (
          <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold tracking-wide text-white shadow-sm">
            −{Math.round((1 - p.price / p.oldPrice) * 100)}%
          </span>
        )}
        {p.badge && (
          <span className="rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-900/5 backdrop-blur">
            {p.badge}
          </span>
        )}
      </div>

      <button
        onClick={() => onToggleFavorite(p.id)}
        className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-slate-500 ring-1 ring-inset ring-slate-900/5 backdrop-blur transition hover:scale-105 hover:text-rose-600"
        aria-label="В избранное"
        data-testid={`favorite-${p.id}`}
      >
        <Heart className={cn('h-4 w-4', favorite && 'fill-rose-500 text-rose-500')} />
      </button>

      <button
        onClick={() => onQuickView(p)}
        className="absolute inset-x-3 bottom-3 translate-y-1 rounded-xl bg-slate-900/85 py-2 text-xs font-semibold text-white opacity-0 shadow-lg backdrop-blur transition duration-300 group-hover:translate-y-0 group-hover:opacity-100"
        data-testid={`quick-view-${p.id}`}
      >
        Быстрый просмотр
      </button>
    </div>

    <div className="flex flex-1 flex-col gap-1.5 p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
        {p.category}
      </p>
      <h4 className="text-[15px] font-semibold leading-snug text-slate-900">{p.title}</h4>

      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <Stars rating={p.rating} />
        {/* Рейтинг по 5-балльной шкале подписан как «из 10». */}
        <span className="font-semibold text-slate-700">{p.rating}/10</span>
        <span className="text-slate-400">· {p.reviews} отзывов</span>
      </div>

      <p className="line-clamp-2 text-sm leading-relaxed text-slate-500">{p.description}</p>

      <p
        className={cn(
          'mt-1 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
          p.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600',
        )}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            p.stock > 0 ? 'bg-emerald-500' : 'bg-rose-500',
          )}
        />
        {p.stock > 0 ? `В наличии: ${p.stock} шт.` : 'Нет в наличии'}
      </p>

      <div className="mt-auto flex items-end gap-2 pt-3">
        <span className="text-[22px] font-bold tracking-tight text-slate-900">
          {money(p.price)} ₽
        </span>
        {p.oldPrice && (
          <span className="pb-1 text-sm text-slate-400 line-through">{money(p.oldPrice)} ₽</span>
        )}
      </div>

      <button
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-orange-600/20 transition hover:bg-orange-700 hover:shadow-md hover:shadow-orange-600/25 active:translate-y-px"
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
            'relative flex h-64 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br ring-1 ring-inset ring-slate-900/5',
            product.gradient,
          )}
        >
          <span className="absolute h-40 w-40 rounded-full bg-white/70 blur-2xl" aria-hidden="true" />
          <span className="relative text-[88px] leading-none drop-shadow-[0_10px_20px_rgba(15,23,42,0.18)]">
            {product.emoji}
          </span>
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
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-orange-600/20 transition hover:bg-orange-700 hover:shadow-md hover:shadow-orange-600/25 active:translate-y-px"
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
      <div className="rounded-3xl border border-slate-200/80 bg-white py-20 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <span className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <ShoppingBag className="h-7 w-7" />
        </span>
        <p className="font-semibold">В корзине пока пусто</p>
        <p className="mt-1 text-sm text-slate-500">Загляните в каталог — там есть что выбрать.</p>
        <button
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-orange-600/20 transition hover:bg-orange-700 active:translate-y-px"
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
        <div className="overflow-x-auto rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
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
                    'flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-3xl ring-1 ring-inset ring-slate-900/5',
                    product.gradient,
                  )}
                >
                  {product.emoji}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{product.title}</p>
                  <p className="text-sm text-slate-500">
                    {money(product.oldPrice ?? product.price)} руб. за шт.
                  </p>
                </div>

                <div className="flex items-center rounded-full bg-slate-100 p-1">
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-600 transition hover:bg-white hover:shadow-sm"
                    onClick={() => changeQty(product.id, line.qty - 1)}
                    data-testid={`qty-minus-${product.id}`}
                    aria-label="Уменьшить"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    className="w-11 bg-transparent text-center text-sm font-semibold outline-none"
                    value={line.qty}
                    onChange={(e) => changeQty(product.id, parseInt(e.target.value, 10))}
                    data-testid={`qty-input-${product.id}`}
                  />
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-600 transition hover:bg-white hover:shadow-sm"
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
                  className="rounded-full p-2.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
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
            className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-inset ring-slate-200 transition hover:text-slate-900 hover:ring-slate-300"
            onClick={goCatalog}
          >
            Продолжить покупки
          </button>
          <button
            className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-inset ring-slate-200 transition hover:text-slate-900 hover:ring-slate-300"
            onClick={clearCart}
            data-testid="clear-cart"
          >
            Очистить корзину
          </button>
        </div>
      </div>

      <div className="h-fit space-y-3 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.35)] lg:sticky lg:top-4">
        <h3 className="text-lg font-semibold">Ваш заказ</h3>

        <div className="flex gap-2">
          <input
            className="field"
            placeholder="Промокод"
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value)}
            data-testid="promo-input"
          />
          <button
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
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

        <div className="flex items-baseline justify-between gap-2 border-t border-slate-100 pt-3">
          <span className="font-semibold">Итого</span>
          {/* Итоговая сумма выводится с тремя знаками после запятой. */}
          <span className="text-2xl font-bold" data-testid="cart-total">
            {total.toFixed(3)} руб.
          </span>
        </div>

        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-orange-600/20 transition hover:bg-orange-700 hover:shadow-md hover:shadow-orange-600/25 active:translate-y-px"
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

  /**
   * Самовывоз оплачивается в пункте выдачи, поэтому данные карты для него
   * необязательны. Для курьера и почты заказ оплачивается онлайн — без карты
   * его оформить нельзя.
   */
  const requiresCard = delivery !== 'pickup';

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  /** Смена способа доставки снимает ошибки по карте, если она больше не нужна. */
  function chooseDelivery(id: string) {
    setDelivery(id);
    if (id !== 'pickup') return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next.cardNumber;
      delete next.cvv;
      return next;
    });
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Укажите имя';
    // Регулярка пропускает «a@b» и не принимает адреса с плюсом.
    if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(form.email)) next.email = 'Некорректный e-mail';
    // Телефон проверяется только на непустоту — буквы проходят.
    if (!form.phone) next.phone = 'Укажите телефон';
    // Проверка адреса всегда истинна: сравнивается сам факт наличия поля.
    if (form.address === undefined) next.address = 'Укажите адрес доставки';
    // Проверяем только заполненность: формат номера карты намеренно не валидируется.
    if (requiresCard) {
      if (!form.cardNumber.trim()) next.cardNumber = 'Укажите номер карты';
      if (!form.cvv.trim()) next.cvv = 'Укажите CVV';
    }
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
                onClick={() => chooseDelivery(o.id)}
                className={cn(
                  'rounded-2xl px-4 py-3 text-left transition',
                  delivery === o.id
                    ? 'bg-orange-50 text-orange-900 ring-2 ring-inset ring-orange-500'
                    : 'bg-white ring-1 ring-inset ring-slate-200 hover:ring-slate-300',
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

        <Section
          step={3}
          title="Оплата"
          badge={
            requiresCard ? (
              <span
                className="rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 ring-1 ring-inset ring-orange-100"
                data-testid="payment-required"
              >
                обязательно
              </span>
            ) : (
              <span
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500"
                data-testid="payment-optional"
              >
                необязательно
              </span>
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Номер карты" error={errors.cardNumber}>
              <input
                className="field"
                value={form.cardNumber}
                onChange={set('cardNumber')}
                placeholder="0000 0000 0000 0000"
                data-testid="co-card"
              />
            </Field>
            <Field label="CVV" error={errors.cvv}>
              {/* CVV вводится открытым текстом и позже показывается в подтверждении. */}
              <input className="field" value={form.cvv} onChange={set('cvv')} data-testid="co-cvv" />
            </Field>
          </div>
          <p
            className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"
            data-testid="payment-note"
          >
            <CreditCard className="h-3.5 w-3.5 shrink-0" />
            {requiresCard
              ? 'Доставка курьером и почтой оплачивается онлайн — заполните данные карты. Они передаются по защищённому соединению.'
              : 'Самовывоз можно оплатить в пункте выдачи, данные карты заполнять не обязательно.'}
          </p>
        </Section>

        {orders.length > 0 && (
          <Section step={4} title="Оформленные заказы">
            <div className="space-y-2">
              {orders.map((o, i) => (
                <div
                  key={i}
                  className="rounded-2xl bg-emerald-50/70 p-4 text-sm ring-1 ring-inset ring-emerald-200"
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

      <div className="h-fit space-y-3 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.35)] lg:sticky lg:top-4">
        <h3 className="text-lg font-semibold">Итого по заказу</h3>
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
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-orange-600/20 transition hover:bg-orange-700 hover:shadow-md hover:shadow-orange-600/25 active:translate-y-px"
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

const Section: React.FC<{
  step: number;
  title: string;
  /** Необязательная пометка справа от заголовка — например, обязателен ли раздел. */
  badge?: React.ReactNode;
  children: React.ReactNode;
}> = ({ step, title, badge, children }) => (
  <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <h3 className="mb-4 flex items-center gap-2.5 text-[15px] font-semibold">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
        {step}
      </span>
      {title}
      {badge}
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
  <footer className="border-t border-slate-100 bg-white px-4 py-6 text-xs text-slate-400 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
          <ShoppingBag className="h-3.5 w-3.5" />
        </span>
        © 2026 СпортАрена — магазин спортивных товаров
      </span>
      <span className="flex gap-5">
        <span className="transition hover:text-slate-600">Доставка и оплата</span>
        <span className="transition hover:text-slate-600">Подбор размера</span>
        <span className="transition hover:text-slate-600">Контакты</span>
      </span>
    </div>
  </footer>
);
