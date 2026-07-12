// Major memory / SSD manufacturers (manufacturing & sales companies) grouped by country.
// category: which product lines the company sells.
//   DRAM = DRAM memory chips/modules
//   NAND = NAND flash / SSD products

export const COUNTRIES = {
  KR: { code: 'KR', name: '韓国', nameEn: 'South Korea' },
  CN: { code: 'CN', name: '中国', nameEn: 'China' },
  US: { code: 'US', name: 'アメリカ', nameEn: 'United States' },
  TW: { code: 'TW', name: '台湾', nameEn: 'Taiwan' },
  JP: { code: 'JP', name: '日本', nameEn: 'Japan' },
};

export const MANUFACTURERS = [
  { id: 'samsung',  name: 'Samsung',     country: 'KR', categories: ['DRAM', 'NAND'] },
  { id: 'skhynix',  name: 'SK hynix',    country: 'KR', categories: ['DRAM', 'NAND'] },
  { id: 'ymtc',     name: 'YMTC',        country: 'CN', categories: ['NAND'] },
  { id: 'cxmt',     name: 'CXMT',        country: 'CN', categories: ['DRAM'] },
  { id: 'micron',   name: 'Micron',      country: 'US', categories: ['DRAM', 'NAND'] },
  { id: 'nanya',    name: 'Nanya',       country: 'TW', categories: ['DRAM'] },
  { id: 'winbond',  name: 'Winbond',     country: 'TW', categories: ['DRAM', 'NAND'] },
  { id: 'kioxia',   name: 'Kioxia',      country: 'JP', categories: ['NAND'] },
];

export const CATEGORIES = {
  DRAM: { code: 'DRAM', name: 'DRAM (メモリ)', unit: 'USD / 8Gb eq.' },
  NAND: { code: 'NAND', name: 'NAND / SSD',    unit: 'USD / 128Gb eq.' },
};

export function manufacturersFor({ country, category } = {}) {
  return MANUFACTURERS.filter((m) => {
    if (country && m.country !== country) return false;
    if (category && !m.categories.includes(category)) return false;
    return true;
  });
}
