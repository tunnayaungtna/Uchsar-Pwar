import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import {
  type TransactionRecord,
  type TransactionType,
  type HoldingRecord,
  type AssetType,
  TRANSACTION_CATEGORIES,
  SG_PLATFORMS,
  formatMyanmarLakhs,
} from '../types';

interface EntryFormModalProps {
  isOpen: boolean;
  mode: 'transaction' | 'holding';
  defaultTxType?: TransactionType;
  currentRate: number;
  editingTransaction?: TransactionRecord | null;
  editingHolding?: HoldingRecord | null;
  onClose: () => void;
  onSaveTransaction: (tx: Omit<TransactionRecord, 'id' | 'ownerId'>) => Promise<void>;
  onSaveHolding: (holding: Omit<HoldingRecord, 'id' | 'ownerId'>) => Promise<void>;
}

export const EntryFormModal: React.FC<EntryFormModalProps> = ({
  isOpen,
  mode: initialMode,
  defaultTxType = 'expense',
  currentRate,
  editingTransaction,
  editingHolding,
  onClose,
  onSaveTransaction,
  onSaveHolding,
}) => {
  const [activeTab, setActiveTab] = useState<'transaction' | 'holding'>(initialMode);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Transaction state
  const [txType, setTxType] = useState<TransactionType>(defaultTxType);
  const [category, setCategory] = useState('Hawker & Groceries');
  const [title, setTitle] = useState('');
  const [amountSgd, setAmountSgd] = useState('');
  const [exchangeRateUsed, setExchangeRateUsed] = useState(String(currentRate));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [recipientOrMerchant, setRecipientOrMerchant] = useState('');
  const [note, setNote] = useState('');

  // Holding state
  const [assetType, setAssetType] = useState<AssetType>('stock');
  const [symbol, setSymbol] = useState('');
  const [assetName, setAssetName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [avgBuyPriceSgd, setAvgBuyPriceSgd] = useState('');
  const [currentPriceSgd, setCurrentPriceSgd] = useState('');
  const [platform, setPlatform] = useState(SG_PLATFORMS[0]);
  const [holdingNote, setHoldingNote] = useState('');

  useEffect(() => {
    setActiveTab(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (editingTransaction) {
      setActiveTab('transaction');
      setTxType(editingTransaction.type);
      setCategory(editingTransaction.category);
      setTitle(editingTransaction.title);
      setAmountSgd(String(editingTransaction.amountSgd));
      setExchangeRateUsed(String(editingTransaction.exchangeRateUsed || currentRate));
      setDate(editingTransaction.date);
      setRecipientOrMerchant(editingTransaction.recipientOrMerchant || '');
      setNote(editingTransaction.note || '');
    } else {
      setTxType(defaultTxType);
      const matchingCat = TRANSACTION_CATEGORIES.find((c) => c.type === defaultTxType);
      if (matchingCat) setCategory(matchingCat.labelEn);
      setTitle('');
      setAmountSgd('');
      setExchangeRateUsed(String(currentRate));
      setDate(new Date().toISOString().slice(0, 10));
      setRecipientOrMerchant('');
      setNote('');
    }
  }, [editingTransaction, defaultTxType, currentRate, isOpen]);

  useEffect(() => {
    if (editingHolding) {
      setActiveTab('holding');
      setAssetType(editingHolding.assetType);
      setSymbol(editingHolding.symbol);
      setAssetName(editingHolding.name);
      setQuantity(String(editingHolding.quantity));
      setAvgBuyPriceSgd(String(editingHolding.avgBuyPriceSgd));
      setCurrentPriceSgd(String(editingHolding.currentPriceSgd));
      setPlatform(editingHolding.platform || SG_PLATFORMS[0]);
      setHoldingNote(editingHolding.note || '');
    } else {
      setSymbol('');
      setAssetName('');
      setQuantity('1');
      setAvgBuyPriceSgd('');
      setCurrentPriceSgd('');
      setPlatform(SG_PLATFORMS[0]);
      setHoldingNote('');
    }
  }, [editingHolding, isOpen]);

  if (!isOpen) return null;

  const parsedSgd = Math.min(100000000, Math.max(0, parseFloat(amountSgd) || 0));
  const parsedRate = Math.min(100000, Math.max(1, parseFloat(exchangeRateUsed) || currentRate));
  const computedMmk = Math.min(1000000000000, Math.round(parsedSgd * parsedRate));

  const availableCategories = TRANSACTION_CATEGORIES.filter((c) => c.type === txType);
  const hasCurrentCategoryInList = availableCategories.some((c) => c.labelEn === category);

  const handleTypeSelect = (nextType: TransactionType) => {
    setTxType(nextType);
    const matchingCategory = TRANSACTION_CATEGORIES.find((c) => c.type === nextType);
    if (matchingCategory) {
      setCategory(matchingCategory.labelEn);
    }
  };

  const handleTxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || parsedSgd <= 0) return;
    const validDate =
      date && date.trim().length >= 8
        ? date.trim().slice(0, 20)
        : new Date().toISOString().slice(0, 10);
    setIsSubmitting(true);
    try {
      await onSaveTransaction({
        type: txType,
        category: (category.trim() || 'Other').slice(0, 60),
        title: title.trim().slice(0, 120),
        amountSgd: parsedSgd,
        exchangeRateUsed: parsedRate,
        amountMmk: computedMmk,
        date: validDate,
        recipientOrMerchant: (recipientOrMerchant.trim() || 'Singapore').slice(0, 100),
        note: note.trim().slice(0, 300),
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleHoldingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Math.min(1000000000, Math.max(0.00000001, parseFloat(quantity) || 0));
    const buyPrice = Math.min(100000000, Math.max(0, parseFloat(avgBuyPriceSgd) || 0));
    const curPrice = Math.min(100000000, Math.max(0, parseFloat(currentPriceSgd) || buyPrice));
    if (!symbol.trim() || !assetName.trim() || qty <= 0) return;

    setIsSubmitting(true);
    try {
      await onSaveHolding({
        assetType,
        symbol: symbol.trim().toUpperCase().slice(0, 30),
        name: assetName.trim().slice(0, 100),
        quantity: qty,
        avgBuyPriceSgd: buyPrice,
        currentPriceSgd: curPrice,
        platform: (platform.trim() || SG_PLATFORMS[0]).slice(0, 80),
        note: holdingNote.trim().slice(0, 240),
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 max-h-[90vh] overflow-y-auto shadow-xl text-slate-900 dark:text-slate-100">
        <div className="w-10 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full mx-auto mb-3 sm:hidden" />

        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-base font-bold">
            {editingTransaction
              ? 'စာရင်းပြင်ဆင်ရန် (Edit Entry)'
              : editingHolding
              ? 'စတော့ / Bitcoin စာရင်းပြင်ဆင်ရန်'
              : 'စာရင်းအသစ်ထည့်ရန်'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!editingTransaction && !editingHolding && (
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl mt-4">
            <button
              type="button"
              onClick={() => setActiveTab('transaction')}
              className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'transaction'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              ဝင်ငွေ / အသုံးစရိတ်
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('holding')}
              className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'holding'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              စတော့ / Bitcoin
            </button>
          </div>
        )}

        {activeTab === 'transaction' ? (
          <form onSubmit={handleTxSubmit} className="mt-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { id: 'expense', label: 'အသုံးစရိတ်' },
                  { id: 'income', label: 'လစာ/ဝင်ငွေ' },
                  { id: 'savings', label: 'စုငွေ' },
                  { id: 'remittance', label: 'အိမ်ပို့ငွေ' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleTypeSelect(item.id)}
                  className={`min-h-[40px] rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                    txType === item.id
                      ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-600 text-emerald-700 dark:text-emerald-300'
                      : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                အမျိုးအစား
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm"
              >
                {!hasCurrentCategoryInList && category && (
                  <option value={category}>{category}</option>
                )}
                {availableCategories.map((cat) => (
                  <option key={cat.labelEn} value={cat.labelEn}>
                    {cat.labelMm} ({cat.labelEn})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                အကြောင်းအရာ
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  txType === 'savings'
                    ? 'ဥပမာ - လစဉ် စုငွေ (DBS / OCBC / MariBank)'
                    : 'ဥပမာ - အိမ်လခ၊ ဖုန်းဘေလ်၊ မိဘထံပို့ငွေ'
                }
                className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  ပမာဏ (SGD $)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amountSgd}
                  onChange={(e) => setAmountSgd(e.target.value)}
                  placeholder="0.00"
                  className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 font-mono-tabular text-base font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  ရက်စွဲ
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 font-mono-tabular text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  ဆိုင်အမည် / လွှဲပို့နည်း (Optional)
                </label>
                <input
                  type="text"
                  value={recipientOrMerchant}
                  onChange={(e) => setRecipientOrMerchant(e.target.value)}
                  placeholder="KBZPay, PayNow..."
                  className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  ပေါက်ဈေး (1 SGD = MMK)
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  required
                  value={exchangeRateUsed}
                  onChange={(e) => setExchangeRateUsed(e.target.value)}
                  className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 font-mono-tabular text-xs sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                မှတ်ချက် (Note - Optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="အပိုမှတ်ချက် ရေးမှတ်ရန်..."
                className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-xs sm:text-sm"
              />
            </div>

            {parsedSgd > 0 && (
              <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-between text-xs">
                <span className="text-emerald-800 dark:text-emerald-300">မြန်မာငွေတန်ဖိုး</span>
                <strong className="text-sm text-emerald-700 dark:text-emerald-400">
                  {formatMyanmarLakhs(computedMmk)}
                </strong>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                မလုပ်တော့ပါ
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
              >
                {isSubmitting
                  ? 'သိမ်းနေသည်...'
                  : editingTransaction
                  ? 'ပြင်ဆင်မှု သိမ်းမည်'
                  : 'သိမ်းမည်'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleHoldingSubmit} className="mt-4 space-y-4">
            {/* Asset Type Selector (Stock / ETF / Crypto) */}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'stock', label: 'စတော့ (Stock)' },
                  { id: 'etf', label: 'ETF' },
                  { id: 'crypto', label: 'Crypto / BTC' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAssetType(item.id)}
                  className={`min-h-[38px] rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap cursor-pointer ${
                    assetType === item.id
                      ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-600 text-emerald-700 dark:text-emerald-300'
                      : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {!editingHolding && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-400 mr-1">အမြန်ရွေးရန်:</span>
                {[
                  { type: 'crypto' as AssetType, sym: 'BTC', name: 'Bitcoin', price: '118500' },
                  { type: 'stock' as AssetType, sym: 'D05.SI', name: 'DBS Group', price: '43.85' },
                  { type: 'stock' as AssetType, sym: 'NVDA', name: 'NVIDIA', price: '184.20' },
                  { type: 'etf' as AssetType, sym: 'CSP1.L', name: 'S&P 500 ETF', price: '792.00' },
                ].map((preset) => (
                  <button
                    key={preset.sym}
                    type="button"
                    onClick={() => {
                      setAssetType(preset.type);
                      setSymbol(preset.sym);
                      setAssetName(preset.name);
                      if (!avgBuyPriceSgd) setAvgBuyPriceSgd(preset.price);
                      setCurrentPriceSgd(preset.price);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-mono-tabular font-semibold cursor-pointer"
                  >
                    {preset.sym}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  သင်္ကေတ (Symbol)
                </label>
                <input
                  type="text"
                  required
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="BTC, D05.SI"
                  className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 font-mono-tabular text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  အရေအတွက် (Quantity)
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 font-mono-tabular text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                အမည်
              </label>
              <input
                type="text"
                required
                value={assetName}
                onChange={(e) => setAssetName(e.target.value)}
                placeholder="Bitcoin / DBS Group"
                className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  ဝယ်ဈေး (Avg Buy SGD)
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={avgBuyPriceSgd}
                  onChange={(e) => setAvgBuyPriceSgd(e.target.value)}
                  placeholder="0.00"
                  className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 font-mono-tabular text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  လက်ရှိဈေး (Current SGD)
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={currentPriceSgd}
                  onChange={(e) => setCurrentPriceSgd(e.target.value)}
                  placeholder="0.00"
                  className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 font-mono-tabular text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Broker / Wallet
                </label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm"
                >
                  {SG_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  မှတ်ချက် (Note - Optional)
                </label>
                <input
                  type="text"
                  value={holdingNote}
                  onChange={(e) => setHoldingNote(e.target.value)}
                  placeholder="DCA / Dividend မှတ်ချက်..."
                  className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-xs sm:text-sm"
                />
              </div>
            </div>

            {(parseFloat(quantity) || 0) > 0 && (parseFloat(currentPriceSgd) || parseFloat(avgBuyPriceSgd) || 0) > 0 && (
              <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-between text-xs">
                <span className="text-emerald-800 dark:text-emerald-300">စုစုပေါင်း မြန်မာငွေတန်ဖိုး</span>
                <strong className="text-sm text-emerald-700 dark:text-emerald-400">
                  {formatMyanmarLakhs(
                    Math.round(
                      (parseFloat(quantity) || 0) *
                        (parseFloat(currentPriceSgd) || parseFloat(avgBuyPriceSgd) || 0) *
                        currentRate
                    )
                  )}
                </strong>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                မလုပ်တော့ပါ
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
              >
                {isSubmitting
                  ? 'သိမ်းနေသည်...'
                  : editingHolding
                  ? 'ပြင်ဆင်မှု သိမ်းမည်'
                  : 'သိမ်းမည်'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
