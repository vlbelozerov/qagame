export interface Product {
  id: number;
  title: string;
  category: 'Электроника' | 'Аксессуары' | 'Бытовая техника' | 'Периферия';
  price: number;
  oldPrice?: number;
  stock: number;
  rating: number;
  description: string;
  emoji: string;
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
