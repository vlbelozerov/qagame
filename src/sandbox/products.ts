export interface Product {
  id: number;
  title: string;
  category: 'Электроника' | 'Аксессуары' | 'Бытовая техника' | 'Периферия';
  price: number;
  oldPrice?: number;
  stock: number;
  rating: number;
  /** Число отзывов — выводится рядом с рейтингом. */
  reviews: number;
  description: string;
  /** Характеристики для карточки быстрого просмотра. */
  specs: [string, string][];
  emoji: string;
  /** Плашка на карточке товара. */
  badge?: 'Хит продаж' | 'Новинка';
  /** Градиент подложки вместо фотографии — внешние картинки не грузим. */
  gradient: string;
}

export const PRODUCTS: Product[] = [
  {
    id: 1,
    title: 'Смартфон Nebula X5',
    category: 'Электроника',
    price: 42990,
    oldPrice: 49990,
    stock: 7,
    rating: 4.7,
    description: 'Флагман с амолед-экраном 6.7" и батареей 5000 мА·ч.',
    emoji: '📱',
    reviews: 312,
    specs: [['Экран', '6.7" AMOLED, 120 Гц'], ['Память', '256 ГБ'], ['Батарея', '5000 мА·ч'], ['Камера', '50 Мп']],
    badge: 'Хит продаж',
    gradient: 'from-indigo-500 via-purple-500 to-fuchsia-500',
  },
  {
    id: 2,
    title: 'Ноутбук Vertex Pro 14',
    category: 'Электроника',
    price: 89900,
    stock: 3,
    rating: 4.5,
    description: 'Лёгкий ультрабук для работы: 16 ГБ ОЗУ, SSD 512 ГБ.',
    emoji: '💻',
    reviews: 87,
    specs: [['Экран', '14" IPS, 2.8K'], ['Процессор', '8 ядер'], ['ОЗУ', '16 ГБ'], ['Накопитель', 'SSD 512 ГБ']],
    gradient: 'from-slate-600 via-slate-500 to-slate-400',
  },
  {
    id: 3,
    title: 'Наушники AirTone Buds',
    category: 'Аксессуары',
    price: 7490,
    oldPrice: 8990,
    stock: 24,
    rating: 4.2,
    description: 'TWS-наушники с активным шумоподавлением.',
    emoji: '🎧',
    reviews: 1204,
    specs: [['Тип', 'TWS'], ['Шумоподавление', 'активное'], ['Автономность', 'до 32 ч'], ['Защита', 'IPX4']],
    badge: 'Хит продаж',
    gradient: 'from-sky-500 via-cyan-500 to-teal-400',
  },
  {
    id: 4,
    title: 'Умные часы Chrono S2',
    category: 'Электроника',
    price: 15900,
    stock: 0,
    rating: 4.0,
    description: 'Пульсометр, GPS, автономность до 10 дней.',
    emoji: '⌚',
    reviews: 56,
    specs: [['Экран', '1.4" AMOLED'], ['Автономность', 'до 10 дней'], ['Датчики', 'пульс, SpO2, GPS'], ['Защита', '5 ATM']],
    gradient: 'from-emerald-500 via-teal-500 to-cyan-500',
  },
  {
    id: 5,
    title: 'Клавиатура Mecha 87',
    category: 'Периферия',
    price: 6300,
    stock: 15,
    rating: 4.8,
    description: 'Механическая клавиатура, коричневые свитчи, RGB.',
    emoji: '⌨️',
    reviews: 438,
    specs: [['Формат', '87 клавиш'], ['Свитчи', 'коричневые'], ['Подсветка', 'RGB'], ['Подключение', 'USB-C']],
    gradient: 'from-orange-500 via-amber-500 to-yellow-400',
  },
  {
    id: 6,
    title: 'Мышь Glide Light',
    category: 'Периферия',
    price: 2990,
    oldPrice: 3990,
    stock: 41,
    rating: 4.4,
    description: 'Беспроводная мышь 12 000 dpi, вес 63 г.',
    emoji: '🖱️',
    reviews: 921,
    specs: [['Сенсор', '12 000 dpi'], ['Вес', '63 г'], ['Подключение', '2.4 ГГц + Bluetooth'], ['Автономность', 'до 70 ч']],
    gradient: 'from-rose-500 via-pink-500 to-fuchsia-400',
  },
  {
    id: 7,
    title: 'Кофемашина BrewMaster',
    category: 'Бытовая техника',
    price: 34900,
    stock: 5,
    rating: 4.6,
    description: 'Автоматическая кофемашина с капучинатором.',
    emoji: '☕',
    reviews: 203,
    specs: [['Тип', 'автоматическая'], ['Давление', '19 бар'], ['Капучинатор', 'есть'], ['Резервуар', '1.8 л']],
    gradient: 'from-amber-700 via-amber-600 to-orange-500',
  },
  {
    id: 8,
    title: 'Робот-пылесос Sweepy 300',
    category: 'Бытовая техника',
    price: 24500,
    oldPrice: 29900,
    stock: 9,
    rating: 4.1,
    description: 'Лидар-навигация, влажная уборка, база самоочистки.',
    emoji: '🤖',
    reviews: 674,
    specs: [['Навигация', 'лидар'], ['Влажная уборка', 'есть'], ['База', 'самоочистка'], ['Автономность', '180 мин']],
    badge: 'Новинка',
    gradient: 'from-violet-600 via-purple-500 to-indigo-500',
  },
  {
    id: 9,
    title: 'Монитор ClearView 27"',
    category: 'Периферия',
    price: 21400,
    stock: 6,
    rating: 4.3,
    description: 'IPS 2560×1440, 165 Гц, USB-C с зарядкой 65 Вт.',
    emoji: '🖥️',
    reviews: 145,
    specs: [['Диагональ', '27"'], ['Разрешение', '2560×1440'], ['Частота', '165 Гц'], ['Порты', 'USB-C 65 Вт, HDMI 2.1']],
    gradient: 'from-blue-600 via-indigo-500 to-violet-500',
  },
  {
    id: 10,
    title: 'Powerbank Volt 20000',
    category: 'Аксессуары',
    price: 3450,
    stock: 33,
    rating: 3.9,
    description: 'Внешний аккумулятор 20 000 мА·ч с быстрой зарядкой.',
    emoji: '🔋',
    reviews: 389,
    specs: [['Ёмкость', '20 000 мА·ч'], ['Мощность', '65 Вт'], ['Порты', '2×USB-C, USB-A'], ['Дисплей', 'есть']],
    gradient: 'from-lime-500 via-green-500 to-emerald-500',
  },
  {
    id: 11,
    title: 'Чехол Guard Silicone',
    category: 'Аксессуары',
    price: 890,
    stock: 120,
    rating: 3.5,
    description: 'Силиконовый чехол с защитой камеры.',
    emoji: '🛡️',
    reviews: 2317,
    specs: [['Материал', 'силикон'], ['Защита камеры', 'есть'], ['Цвет', 'графит'], ['Совместимость', 'Nebula X5']],
    gradient: 'from-stone-500 via-stone-400 to-neutral-400',
  },
  {
    id: 12,
    title: 'Планшет Slate Air 11',
    category: 'Электроника',
    price: 39900,
    oldPrice: 44900,
    stock: 0,
    rating: 4.4,
    description: 'Планшет 11" 120 Гц с поддержкой стилуса.',
    emoji: '📟',
    reviews: 78,
    specs: [['Экран', '11", 120 Гц'], ['Память', '128 ГБ'], ['Стилус', 'поддерживается'], ['Батарея', '8000 мА·ч']],
    badge: 'Новинка',
    gradient: 'from-fuchsia-600 via-pink-500 to-rose-500',
  },
];

export const CATEGORIES = [
  'Все категории',
  'Электроника',
  'Аксессуары',
  'Бытовая техника',
  'Периферия',
] as const;

/** Промокоды, о которых участникам сообщается в описании тренажёра. */
export const PROMO_CODES: Record<string, number> = {
  SALE10: 10,
  QA2026: 15,
};

export const FREE_SHIPPING_THRESHOLD = 5000;
export const SHIPPING_COST = 490;
