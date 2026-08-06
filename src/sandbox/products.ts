export interface Product {
  id: number;
  title: string;
  category: 'Обувь' | 'Одежда' | 'Тренажёры' | 'Аксессуары';
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
    title: 'Кроссовки Stride Pro',
    category: 'Обувь',
    price: 8990,
    oldPrice: 11990,
    stock: 12,
    rating: 4.7,
    reviews: 312,
    description: 'Беговые кроссовки с амортизирующей подошвой для асфальта.',
    specs: [
      ['Назначение', 'бег по асфальту'],
      ['Вес', '245 г (42 размер)'],
      ['Перепад', '8 мм'],
      ['Размеры', '38–46'],
    ],
    emoji: '👟',
    badge: 'Хит продаж',
    gradient: 'from-orange-500 via-rose-500 to-pink-500',
  },
  {
    id: 2,
    title: 'Беговая дорожка RunWay T5',
    category: 'Тренажёры',
    price: 74900,
    stock: 3,
    rating: 4.5,
    reviews: 87,
    description: 'Складная дорожка до 16 км/ч с 12 программами тренировок.',
    specs: [
      ['Мощность', '2.5 л.с.'],
      ['Скорость', 'до 16 км/ч'],
      ['Наклон', 'до 12%'],
      ['Макс. вес', '130 кг'],
    ],
    emoji: '🏃',
    gradient: 'from-slate-600 via-slate-500 to-slate-400',
  },
  {
    id: 3,
    title: 'Фитнес-браслет PulseFit 3',
    category: 'Аксессуары',
    price: 5490,
    oldPrice: 6990,
    stock: 24,
    rating: 4.2,
    reviews: 1204,
    description: 'Пульсометр, счётчик шагов и контроль сна, автономность 14 дней.',
    specs: [
      ['Экран', '1.1" AMOLED'],
      ['Автономность', 'до 14 дней'],
      ['Датчики', 'пульс, SpO2'],
      ['Защита', '5 ATM'],
    ],
    emoji: '⌚',
    badge: 'Хит продаж',
    gradient: 'from-sky-500 via-cyan-500 to-teal-400',
  },
  {
    id: 4,
    title: 'Гантели наборные PowerSet 2×20 кг',
    category: 'Тренажёры',
    price: 15900,
    stock: 0,
    rating: 4.0,
    reviews: 56,
    description: 'Разборные гантели с быстрой сменой веса от 2 до 20 кг.',
    specs: [
      ['Вес', '2 × 20 кг'],
      ['Шаг', '2 кг'],
      ['Покрытие', 'обрезиненное'],
      ['Гриф', 'сталь, насечка'],
    ],
    emoji: '🏋️',
    gradient: 'from-emerald-500 via-teal-500 to-cyan-500',
  },
  {
    id: 5,
    title: 'Коврик для йоги ZenMat Pro',
    category: 'Аксессуары',
    price: 3300,
    stock: 15,
    rating: 4.8,
    reviews: 438,
    description: 'Нескользящий коврик 6 мм из натурального каучука.',
    specs: [
      ['Размер', '183 × 68 см'],
      ['Толщина', '6 мм'],
      ['Материал', 'каучук'],
      ['Вес', '2.4 кг'],
    ],
    emoji: '🧘',
    gradient: 'from-violet-500 via-purple-500 to-fuchsia-500',
  },
  {
    id: 6,
    title: 'Скакалка SpeedRope X',
    category: 'Аксессуары',
    price: 990,
    oldPrice: 1490,
    stock: 41,
    rating: 4.4,
    reviews: 921,
    description: 'Скоростная скакалка на подшипниках с регулировкой длины.',
    specs: [
      ['Трос', 'сталь в оплётке'],
      ['Длина', 'до 3 м'],
      ['Подшипники', 'двойные'],
      ['Ручки', 'алюминий'],
    ],
    emoji: '🪢',
    gradient: 'from-rose-500 via-pink-500 to-fuchsia-400',
  },
  {
    id: 7,
    title: 'Велотренажёр CycloFit 500',
    category: 'Тренажёры',
    price: 34900,
    stock: 5,
    rating: 4.6,
    reviews: 203,
    description: 'Вертикальный велотренажёр с магнитной нагрузкой и пульсометром.',
    specs: [
      ['Нагрузка', 'магнитная, 16 уровней'],
      ['Маховик', '8 кг'],
      ['Макс. вес', '120 кг'],
      ['Дисплей', 'LCD'],
    ],
    emoji: '🚴',
    gradient: 'from-amber-600 via-orange-500 to-red-500',
  },
  {
    id: 8,
    title: 'Гребной тренажёр WaveRow',
    category: 'Тренажёры',
    price: 54500,
    oldPrice: 62900,
    stock: 9,
    rating: 4.1,
    reviews: 674,
    description: 'Гребной тренажёр с водным сопротивлением и складной рамой.',
    specs: [
      ['Сопротивление', 'водное'],
      ['Длина рельса', '124 см'],
      ['Макс. вес', '150 кг'],
      ['Хранение', 'вертикальное'],
    ],
    emoji: '🚣',
    badge: 'Новинка',
    gradient: 'from-blue-600 via-indigo-500 to-violet-500',
  },
  {
    id: 9,
    title: 'Термофутболка DryFlex',
    category: 'Одежда',
    price: 2400,
    stock: 6,
    rating: 4.3,
    reviews: 145,
    description: 'Влагоотводящая футболка для тренировок с плоскими швами.',
    specs: [
      ['Материал', 'полиэстер 92%, эластан 8%'],
      ['Крой', 'приталенный'],
      ['Швы', 'плоские'],
      ['Размеры', 'S–XXL'],
    ],
    emoji: '👕',
    gradient: 'from-lime-500 via-green-500 to-emerald-500',
  },
  {
    id: 10,
    title: 'Шейкер HydroMix 700',
    category: 'Аксессуары',
    price: 890,
    stock: 33,
    rating: 3.9,
    reviews: 389,
    description: 'Шейкер 700 мл с венчиком и отсеком для добавок.',
    specs: [
      ['Объём', '700 мл'],
      ['Материал', 'тритан, без BPA'],
      ['Венчик', 'металлический'],
      ['Отсек', 'на 150 мл'],
    ],
    emoji: '🥤',
    gradient: 'from-cyan-500 via-sky-500 to-blue-500',
  },
  {
    id: 11,
    title: 'Носки компрессионные RunSoft',
    category: 'Одежда',
    price: 690,
    stock: 120,
    rating: 3.5,
    reviews: 2317,
    description: 'Компрессионные носки для бега с усиленной пяткой.',
    specs: [
      ['Компрессия', '18–22 мм рт. ст.'],
      ['Материал', 'нейлон, эластан'],
      ['Высота', 'до середины голени'],
      ['Размеры', '36–46'],
    ],
    emoji: '🧦',
    gradient: 'from-stone-500 via-stone-400 to-neutral-400',
  },
  {
    id: 12,
    title: 'Кроссовки трейловые TrailGrip 2',
    category: 'Обувь',
    price: 12900,
    oldPrice: 15900,
    stock: 0,
    rating: 4.4,
    reviews: 78,
    description: 'Трейловые кроссовки с агрессивным протектором и защитой носка.',
    specs: [
      ['Назначение', 'бег по грунту'],
      ['Протектор', '5 мм'],
      ['Мембрана', 'водоотталкивающая'],
      ['Размеры', '39–47'],
    ],
    emoji: '🥾',
    badge: 'Новинка',
    gradient: 'from-fuchsia-600 via-pink-500 to-rose-500',
  },
];

export const CATEGORIES = ['Все категории', 'Обувь', 'Одежда', 'Тренажёры', 'Аксессуары'] as const;

/** Промокоды, о которых участникам сообщается на баннере магазина. */
export const PROMO_CODES: Record<string, number> = {
  SALE10: 10,
  QA2026: 15,
};

export const FREE_SHIPPING_THRESHOLD = 5000;
export const SHIPPING_COST = 490;
