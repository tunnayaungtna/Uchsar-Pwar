export type TransactionType = 'income' | 'expense' | 'remittance' | 'savings';

export interface VaultConfig {
  ownerId: string;
  sgdToMmkRate: number;
  bankOfficialRate: number;
  monthlySalarySgd: number;
  monthlyRentSgd: number;
  monthlySavingsTargetSgd: number;
  biometricEnabled: boolean;
  passkeyId: string;
  pinCode: string;
  autoLockMinutes: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TransactionRecord {
  id: string;
  ownerId: string;
  type: TransactionType;
  category: string;
  title: string;
  amountSgd: number;
  exchangeRateUsed: number;
  amountMmk: number;
  date: string;
  recipientOrMerchant: string;
  note: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type AssetType = 'stock' | 'crypto' | 'etf';

export interface HoldingRecord {
  id: string;
  ownerId: string;
  assetType: AssetType;
  symbol: string;
  name: string;
  quantity: number;
  avgBuyPriceSgd: number;
  currentPriceSgd: number;
  platform: string;
  note: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export const TRANSACTION_CATEGORIES: {
  type: TransactionType;
  labelEn: string;
  labelMm: string;
}[] = [
  { type: 'savings', labelEn: 'Monthly Savings (SG Bank)', labelMm: 'စုငွေ (စင်ကာပူဘဏ် စုငွေ)' },
  { type: 'savings', labelEn: 'Emergency Fund', labelMm: 'စုငွေ (အရေးပေါ် စုငွေ)' },
  { type: 'savings', labelEn: 'Fixed Deposit / T-Bills', labelMm: 'စုငွေ (Fixed Deposit / T-Bill)' },
  { type: 'income', labelEn: 'Monthly Salary', labelMm: 'လစာ ရငွေ' },
  { type: 'income', labelEn: 'Bonus & Overtime', labelMm: 'အပိုဆုကြေး / OT' },
  { type: 'income', labelEn: 'Dividends & Freelance', labelMm: 'အမြတ်ဝေစု / အခြားဝင်ငွေ' },
  { type: 'expense', labelEn: 'Room / HDB Rent', labelMm: 'အိမ်လခ ပေးငွေ' },
  { type: 'remittance', labelEn: 'Family Remittance (MM)', labelMm: 'မြန်မာပြည် အိမ်ပို့ငွေ' },
  { type: 'expense', labelEn: 'MRT & Bus (SimplyGo)', labelMm: 'သွားလာစရိတ် (MRT/Bus)' },
  { type: 'expense', labelEn: 'Phone & Fibre Bill', labelMm: 'ဖုန်းဘေလ်နှင့် အင်တာနက်' },
  { type: 'expense', labelEn: 'Hawker & Groceries', labelMm: 'စားသောက်စရိတ် (Hawker/NTUC)' },
  { type: 'expense', labelEn: 'PUB Utilities & Aircon', labelMm: 'ရေဖိုး မီးဖိုး (PUB)' },
  { type: 'expense', labelEn: 'Medical & Insurance', labelMm: 'ကျန်းမာရေးနှင့် အာမခံ' },
  { type: 'expense', labelEn: 'Personal & Shopping', labelMm: 'ကိုယ်ပိုင်အသုံးစရိတ်' },
];

export const SG_PLATFORMS = [
  'Moomoo SG',
  'Tiger Brokers SG',
  'Interactive Brokers (IBKR)',
  'DBS Vickers / POSB',
  'FSMOne / Syfe',
  'Coinbase SG',
  'Independent Reserve SG',
  'Ledger Hardware Wallet',
];

/**
 * Formats Myanmar Kyat into readable Burmese Lakhs (သိန်း / သောင်း / ကျပ်)
 */
export function formatMyanmarLakhs(mmkAmount: number): string {
  const rounded = Math.round(Math.abs(mmkAmount));
  if (rounded === 0) return '0 ကျပ်';

  const lakhs = Math.floor(rounded / 100000);
  const remainderAfterLakhs = rounded % 100000;
  const tenThousands = Math.floor(remainderAfterLakhs / 10000);
  const thousands = Math.floor((remainderAfterLakhs % 10000) / 1000);

  const parts: string[] = [];
  if (lakhs > 0) {
    parts.push(`${lakhs.toLocaleString('en-US')} သိန်း`);
  }
  if (tenThousands > 0) {
    parts.push(`${tenThousands} သောင်း`);
  }
  if (thousands > 0 && lakhs < 100) {
    parts.push(`${thousands} ထောင်`);
  }
  if (parts.length === 0) {
    return `${rounded.toLocaleString('en-US')} ကျပ်`;
  }
  return `${parts.join(' ')} ကျပ်`;
}

export function formatSgd(amount: number): string {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatMmk(amount: number): string {
  return `${Math.round(amount).toLocaleString('en-US')} MMK`;
}
