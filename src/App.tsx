/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore';
import {
  Lock,
  Fingerprint,
  RefreshCw,
  Plus,
  Trash2,
  Edit3,
  LogIn,
  LogOut,
  TrendingUp,
  CheckCircle2,
  Home,
  Receipt,
  Sun,
  Moon,
  Settings,
  Download,
  Upload,
  FileSpreadsheet,
  AlertCircle,
  Search,
  X,
  Smartphone,
  Share2,
  Calendar,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  type VaultConfig,
  type TransactionRecord,
  type TransactionType,
  type HoldingRecord,
  TRANSACTION_CATEGORIES,
  formatSgd,
  formatMmk,
  formatMyanmarLakhs,
} from './types';
import {
  DEFAULT_VAULT_CONFIG,
  INITIAL_TRANSACTIONS,
  INITIAL_HOLDINGS,
} from './utils/sampleData';
import {
  registerBiometricPasskey,
  isPlatformBiometricSupported,
} from './utils/webauthn';
import { BiometricLockScreen } from './components/BiometricLockScreen';
import { EntryFormModal } from './components/EntryFormModal';

type NavSection = 'overview' | 'cashflow' | 'portfolio' | 'settings';
type TxViewMode = 'daily_grouped' | 'daily_summary' | 'table';

const MYANMAR_MONTH_NAMES: Record<string, string> = {
  '01': 'ဇန်နဝါရီလ',
  '02': 'ဖေဖော်ဝါရီလ',
  '03': 'မတ်လ',
  '04': 'ဧပြီလ',
  '05': 'မေလ',
  '06': 'ဇွန်လ',
  '07': 'ဇူလိုင်လ',
  '08': 'ဩဂုတ်လ',
  '09': 'စက်တင်ဘာလ',
  '10': 'အောက်တိုဘာလ',
  '11': 'နိုဝင်ဘာလ',
  '12': 'ဒီဇင်ဘာလ',
};

const MYANMAR_WEEKDAYS = [
  'တနင်္ဂနွေနေ့',
  'တနင်္လာနေ့',
  'အင်္ဂါနေ့',
  'ဗုဒ္ဓဟူးနေ့',
  'ကြာသပတေးနေ့',
  'သောကြာနေ့',
  'စနေနေ့',
];

function formatMyanmarMonthLabel(yyyyMm: string): string {
  const parts = yyyyMm.split('-');
  if (parts.length !== 2) return yyyyMm;
  const [year, month] = parts;
  return `${year} ${MYANMAR_MONTH_NAMES[month] || month}`;
}

function formatMyanmarDateWeekday(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const dt = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return dateStr;
  const weekday = MYANMAR_WEEKDAYS[dt.getDay()] || '';
  const todayStr = new Date().toISOString().slice(0, 10);
  if (dateStr === todayStr) {
    return `${dateStr} · ${weekday} (ယနေ့)`;
  }
  return `${dateStr} · ${weekday}`;
}

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [isVaultLocked, setIsVaultLocked] = useState<boolean>(true);

  // Day Mode / Night Mode
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem('merlion_theme_mode') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('merlion_theme_mode', isDark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [isDark]);

  // Modal State
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalMode, setModalMode] = useState<'transaction' | 'holding'>('transaction');
  const [defaultModalTxType, setDefaultModalTxType] = useState<TransactionType>('expense');
  const [editingTx, setEditingTx] = useState<TransactionRecord | null>(null);
  const [editingHolding, setEditingHolding] = useState<HoldingRecord | null>(null);

  // Auth
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);

  // Core Data
  const [vaultConfig, setVaultConfig] = useState<VaultConfig>(() => {
    try {
      const saved = localStorage.getItem('merlion_vault_config_v1');
      return saved ? JSON.parse(saved) : DEFAULT_VAULT_CONFIG;
    } catch {
      return DEFAULT_VAULT_CONFIG;
    }
  });

  const [transactions, setTransactions] = useState<TransactionRecord[]>(() => {
    try {
      const saved = localStorage.getItem('merlion_transactions_v1');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_TRANSACTIONS.map((tx) => ({ ...tx, ownerId: 'local_user' }));
  });

  const [holdings, setHoldings] = useState<HoldingRecord[]>(() => {
    try {
      const saved = localStorage.getItem('merlion_holdings_v1');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_HOLDINGS.map((h) => ({ ...h, ownerId: 'local_user' }));
  });

  // Simple Filter & Search + Daily/Monthly Browsing State
  const [txFilter, setTxFilter] = useState<'all' | 'income' | 'expense' | 'remittance' | 'savings'>('all');
  const [txMonthFilter, setTxMonthFilter] = useState<string>('all');
  const [txSpecificDate, setTxSpecificDate] = useState<string>('');
  const [txViewMode, setTxViewMode] = useState<TxViewMode>('daily_grouped');
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [visibleDayLimit, setVisibleDayLimit] = useState<number>(15);
  const [visibleTableLimit, setVisibleTableLimit] = useState<number>(30);
  const [holdingFilter, setHoldingFilter] = useState<'all' | 'stock' | 'etf' | 'crypto'>('all');
  const [txSearchQuery, setTxSearchQuery] = useState<string>('');
  const [isOverviewSearchOpen, setIsOverviewSearchOpen] = useState<boolean>(false);
  const [expensePeriod, setExpensePeriod] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  const [includeRemittanceInChart, setIncludeRemittanceInChart] = useState<boolean>(true);

  // Instant Two-Way SGD ↔ MMK Calculator
  const [calcSgd, setCalcSgd] = useState<string>('1000');
  const [calcLakhs, setCalcLakhs] = useState<string>(() =>
    ((1000 * DEFAULT_VAULT_CONFIG.sgdToMmkRate) / 100000).toFixed(2)
  );
  const [rateDraft, setRateDraft] = useState<string>(String(vaultConfig.sgdToMmkRate));
  const [isEditingRate, setIsEditingRate] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isRefreshingMarket, setIsRefreshingMarket] = useState<boolean>(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Offline / Online Status & Local Optimistic Sync Tracking
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const deletedIdsRef = useRef<Set<string>>(
    (() => {
      try {
        const raw = localStorage.getItem('merlion_deleted_ids_v1');
        return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
      } catch {
        return new Set<string>();
      }
    })()
  );
  const localUpdatedTxRef = useRef<Map<string, TransactionRecord>>(new Map());
  const localUpdatedHoldRef = useRef<Map<string, HoldingRecord>>(new Map());

  // Security Drafts
  const [currentPinDraft, setCurrentPinDraft] = useState<string>('');
  const [pinDraft, setPinDraft] = useState<string>('');
  const [securityFormError, setSecurityFormError] = useState<string | null>(null);
  const [autoLockDraft, setAutoLockDraft] = useState<string>(
    String(vaultConfig.autoLockMinutes || 15)
  );
  const [hardwareBioSupported, setHardwareBioSupported] = useState<boolean>(false);

  // PWA Install Prompt & Standalone State
  const [pwaInstallPrompt, setPwaInstallPrompt] = useState<any>(() => {
    return (window as any).__deferredPwaPrompt || null;
  });
  const [isStandaloneApp, setIsStandaloneApp] = useState<boolean>(() => {
    try {
      return (
        window.matchMedia('(display-mode: standalone)').matches ||
        Boolean((window.navigator as any).standalone)
      );
    } catch {
      return false;
    }
  });
  const [showInstallGuideModal, setShowInstallGuideModal] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setErrorBanner(null);
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    const syncPrompt = () => {
      if ((window as any).__deferredPwaPrompt) {
        setPwaInstallPrompt((window as any).__deferredPwaPrompt);
      }
    };
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).__deferredPwaPrompt = e;
      setPwaInstallPrompt(e);
    };
    const handleAppInstalled = () => {
      (window as any).__deferredPwaPrompt = null;
      setPwaInstallPrompt(null);
      setIsStandaloneApp(true);
      setShowInstallGuideModal(false);
      showToast('ဥစ္စာပွား App ကို ဖုန်းထဲသို့ သွင်းပြီးပါပြီ');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('uchsar-pwa-prompt-ready', syncPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    syncPrompt();
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('uchsar-pwa-prompt-ready', syncPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallAppClick = async () => {
    const promptEvent = pwaInstallPrompt || (window as any).__deferredPwaPrompt;
    if (promptEvent && typeof promptEvent.prompt === 'function') {
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === 'accepted') {
          (window as any).__deferredPwaPrompt = null;
          setPwaInstallPrompt(null);
          showToast('ဥစ္စာပွား App ကို ဖုန်းထဲသို့ သွင်းနေပါသည်...');
          return;
        }
      } catch {
        // Fall through to guide modal
      }
    }
    setShowInstallGuideModal(true);
  };

  const openAddModal = (type: TransactionType) => {
    setEditingTx(null);
    setEditingHolding(null);
    setDefaultModalTxType(type);
    setModalMode('transaction');
    setModalOpen(true);
  };

  const openEditTransactionModal = (tx: TransactionRecord) => {
    setEditingHolding(null);
    setEditingTx(tx);
    setModalMode('transaction');
    setModalOpen(true);
  };

  const openEditHoldingModal = (holding: HoldingRecord) => {
    setEditingTx(null);
    setEditingHolding(holding);
    setModalMode('holding');
    setModalOpen(true);
  };

  useEffect(() => {
    isPlatformBiometricSupported().then(setHardwareBioSupported);
  }, []);

  useEffect(() => {
    setRateDraft(String(vaultConfig.sgdToMmkRate));
    setAutoLockDraft(String(vaultConfig.autoLockMinutes || 15));
    const currentSgdNum = parseFloat(calcSgd) || 0;
    setCalcLakhs(((currentSgdNum * vaultConfig.sgdToMmkRate) / 100000).toFixed(2));
  }, [vaultConfig.sgdToMmkRate, vaultConfig.pinCode, vaultConfig.autoLockMinutes]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Always persist all data locally on device so the app works 100% offline with zero latency
  useEffect(() => {
    try {
      localStorage.setItem('merlion_vault_config_v1', JSON.stringify(vaultConfig));
      localStorage.setItem('merlion_transactions_v1', JSON.stringify(transactions));
      localStorage.setItem('merlion_holdings_v1', JSON.stringify(holdings));
    } catch {
      // ignore storage errors
    }
  }, [vaultConfig, transactions, holdings]);

  useEffect(() => {
    try {
      localStorage.setItem('uchsar_vault_is_locked', isVaultLocked ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [isVaultLocked]);

  const handleUnlockVault = useCallback(() => {
    try {
      localStorage.setItem('uchsar_vault_is_locked', 'false');
      if (!window.history.state || !window.history.state.uchsarGuard) {
        window.history.pushState({ uchsarGuard: 'unlocked', ts: Date.now() }, '');
      }
    } catch {
      // ignore history/storage errors
    }
    setIsVaultLocked(false);
  }, []);

  // Immediate Lock on Back Key Exit, Re-Entry (bfcache/pageshow), App Switch, or Screen Off
  useEffect(() => {
    const lockImmediately = () => {
      try {
        localStorage.setItem('uchsar_vault_is_locked', 'true');
      } catch {
        // ignore
      }
      setModalOpen(false);
      setShowInstallGuideModal(false);
      setIsVaultLocked(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        lockImmediately();
      } else if (document.visibilityState === 'visible') {
        try {
          if (localStorage.getItem('uchsar_vault_is_locked') !== 'false') {
            setIsVaultLocked(true);
          }
        } catch {
          setIsVaultLocked(true);
        }
      }
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      // If restored from back-forward cache (e.g. after Back key exit) or marked locked, lock immediately
      if (event.persisted) {
        lockImmediately();
        return;
      }
      try {
        if (localStorage.getItem('uchsar_vault_is_locked') !== 'false') {
          setIsVaultLocked(true);
        }
      } catch {
        setIsVaultLocked(true);
      }
    };

    const handlePopState = () => {
      // When user presses the hardware/browser Back button
      if (modalOpen || showInstallGuideModal) {
        setModalOpen(false);
        setShowInstallGuideModal(false);
        try {
          window.history.pushState({ uchsarGuard: 'unlocked', ts: Date.now() }, '');
        } catch {
          // ignore
        }
        return;
      }
      // Lock immediately when backing out of the app
      lockImmediately();
    };

    const handleWindowFocus = () => {
      try {
        if (localStorage.getItem('uchsar_vault_is_locked') !== 'false') {
          setIsVaultLocked(true);
        }
      } catch {
        // ignore
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', lockImmediately);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('freeze', lockImmediately);
    window.addEventListener('resume', handleWindowFocus);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('beforeunload', lockImmediately);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', lockImmediately);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('freeze', lockImmediately);
      window.removeEventListener('resume', handleWindowFocus);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('beforeunload', lockImmediately);
    };
  }, [modalOpen, showInstallGuideModal]);

  // Idle Auto-Lock
  useEffect(() => {
    if (isVaultLocked) return;
    const timeoutMs = Math.max(1, vaultConfig.autoLockMinutes || 15) * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setIsVaultLocked(true), timeoutMs);
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [vaultConfig.autoLockMinutes, isVaultLocked]);

  // Firebase Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const bootstrapCloudVault = useCallback(async (user: User) => {
    const configPath = `vaultConfigs/${user.uid}`;
    const configRef = doc(db, 'vaultConfigs', user.uid);
    try {
      await setDoc(
        configRef,
        {
          ownerId: user.uid,
          sgdToMmkRate: DEFAULT_VAULT_CONFIG.sgdToMmkRate,
          bankOfficialRate: DEFAULT_VAULT_CONFIG.bankOfficialRate,
          monthlySalarySgd: DEFAULT_VAULT_CONFIG.monthlySalarySgd,
          monthlyRentSgd: DEFAULT_VAULT_CONFIG.monthlyRentSgd,
          monthlySavingsTargetSgd: DEFAULT_VAULT_CONFIG.monthlySavingsTargetSgd,
          biometricEnabled: DEFAULT_VAULT_CONFIG.biometricEnabled,
          passkeyId: DEFAULT_VAULT_CONFIG.passkeyId,
          pinCode: DEFAULT_VAULT_CONFIG.pinCode,
          autoLockMinutes: DEFAULT_VAULT_CONFIG.autoLockMinutes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: false }
      );

      for (const tx of INITIAL_TRANSACTIONS) {
        await setDoc(doc(db, 'users', user.uid, 'transactions', tx.id), {
          ownerId: user.uid,
          type: tx.type,
          category: tx.category,
          title: tx.title,
          amountSgd: tx.amountSgd,
          exchangeRateUsed: tx.exchangeRateUsed,
          amountMmk: tx.amountMmk,
          date: tx.date,
          recipientOrMerchant: tx.recipientOrMerchant.trim(),
          note: tx.note,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      for (const h of INITIAL_HOLDINGS) {
        await setDoc(doc(db, 'users', user.uid, 'holdings', h.id), {
          ownerId: user.uid,
          assetType: h.assetType,
          symbol: h.symbol,
          name: h.name,
          quantity: h.quantity,
          avgBuyPriceSgd: h.avgBuyPriceSgd,
          currentPriceSgd: h.currentPriceSgd,
          platform: h.platform,
          note: h.note,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, configPath);
    }
  }, []);

  useEffect(() => {
    if (!isAuthReady || !currentUser) return;

    const configPath = `vaultConfigs/${currentUser.uid}`;
    const configRef = doc(db, 'vaultConfigs', currentUser.uid);

    const txPath = `users/${currentUser.uid}/transactions`;
    const txQuery = query(
      collection(db, 'users', currentUser.uid, 'transactions'),
      orderBy('date', 'desc')
    );

    const holdPath = `users/${currentUser.uid}/holdings`;
    const holdQuery = query(collection(db, 'users', currentUser.uid, 'holdings'));

    const unsubConfig = onSnapshot(
      configRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          if (typeof navigator === 'undefined' || navigator.onLine) {
            bootstrapCloudVault(currentUser).catch(() => {});
          }
          return;
        }
        setVaultConfig((prev) => ({
          ...prev,
          ...(snapshot.data() as VaultConfig),
        }));
      },
      (err) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        try {
          handleFirestoreError(err, OperationType.GET, configPath);
        } catch {
          // ignore offline/background sync errors
        }
      }
    );

    const unsubTx = onSnapshot(
      txQuery,
      (txSnap) => {
        if (txSnap.empty) return;
        setTransactions((prev) => {
          const mergedMap = new Map<string, TransactionRecord>();
          txSnap.docs.forEach((d) => {
            if (!deletedIdsRef.current.has(d.id)) {
              const localOverride = localUpdatedTxRef.current.get(d.id);
              mergedMap.set(
                d.id,
                localOverride || {
                  id: d.id,
                  ...(d.data() as Omit<TransactionRecord, 'id'>),
                }
              );
            }
          });
          // Keep any locally added transactions not yet in cloud snapshot
          prev.forEach((localTx) => {
            if (!deletedIdsRef.current.has(localTx.id) && !mergedMap.has(localTx.id)) {
              mergedMap.set(localTx.id, localTx);
            }
          });
          localUpdatedTxRef.current.forEach((tx, id) => {
            if (!deletedIdsRef.current.has(id)) {
              mergedMap.set(id, tx);
            }
          });
          return Array.from(mergedMap.values()).sort((a, b) => b.date.localeCompare(a.date));
        });
      },
      (err) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        try {
          handleFirestoreError(err, OperationType.LIST, txPath);
        } catch {
          // ignore offline/background sync errors
        }
      }
    );

    const unsubHoldings = onSnapshot(
      holdQuery,
      (holdSnap) => {
        if (holdSnap.empty) return;
        setHoldings((prev) => {
          const mergedMap = new Map<string, HoldingRecord>();
          holdSnap.docs.forEach((d) => {
            if (!deletedIdsRef.current.has(d.id)) {
              const localOverride = localUpdatedHoldRef.current.get(d.id);
              mergedMap.set(
                d.id,
                localOverride || {
                  id: d.id,
                  ...(d.data() as Omit<HoldingRecord, 'id'>),
                }
              );
            }
          });
          prev.forEach((localHold) => {
            if (!deletedIdsRef.current.has(localHold.id) && !mergedMap.has(localHold.id)) {
              mergedMap.set(localHold.id, localHold);
            }
          });
          localUpdatedHoldRef.current.forEach((hold, id) => {
            if (!deletedIdsRef.current.has(id)) {
              mergedMap.set(id, hold);
            }
          });
          return Array.from(mergedMap.values());
        });
      },
      (err) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        try {
          handleFirestoreError(err, OperationType.LIST, holdPath);
        } catch {
          // ignore offline/background sync errors
        }
      }
    );

    return () => {
      unsubConfig();
      unsubTx();
      unsubHoldings();
    };
  }, [isAuthReady, currentUser, bootstrapCloudVault]);

  // Metrics
  const metrics = useMemo(() => {
    const rate = vaultConfig.sgdToMmkRate || 3380;
    let totalIncomeSgd = 0;
    let totalIncomeMmk = 0;
    let totalExpenseSgd = 0;
    let totalExpenseMmk = 0;
    let totalRemittanceSgd = 0;
    let totalRemittanceMmk = 0;
    let totalSavingsSgd = 0;
    let totalSavingsMmk = 0;

    transactions.forEach((tx) => {
      if (tx.type === 'income') {
        totalIncomeSgd += tx.amountSgd;
        totalIncomeMmk += tx.amountMmk;
      } else if (tx.type === 'remittance') {
        totalRemittanceSgd += tx.amountSgd;
        totalRemittanceMmk += tx.amountMmk;
      } else if (tx.type === 'savings') {
        totalSavingsSgd += tx.amountSgd;
        totalSavingsMmk += tx.amountMmk;
      } else {
        totalExpenseSgd += tx.amountSgd;
        totalExpenseMmk += tx.amountMmk;
      }
    });

    const cashInHandSgd = Math.max(
      0,
      totalIncomeSgd - totalExpenseSgd - totalRemittanceSgd - totalSavingsSgd
    );
    const cashInHandMmk = Math.round(cashInHandSgd * rate);

    let portfolioCostSgd = 0;
    let portfolioValueSgd = 0;

    holdings.forEach((h) => {
      portfolioCostSgd += h.quantity * h.avgBuyPriceSgd;
      portfolioValueSgd += h.quantity * h.currentPriceSgd;
    });

    const portfolioProfitSgd = portfolioValueSgd - portfolioCostSgd;
    const portfolioProfitPct =
      portfolioCostSgd > 0 ? (portfolioProfitSgd / portfolioCostSgd) * 100 : 0;
    const portfolioValueMmk = Math.round(portfolioValueSgd * rate);
    const portfolioCostMmk = Math.round(portfolioCostSgd * rate);
    const portfolioProfitMmk = Math.round(portfolioProfitSgd * rate);

    return {
      rate,
      totalIncomeSgd,
      totalIncomeMmk,
      totalExpenseSgd,
      totalExpenseMmk,
      totalRemittanceSgd,
      totalRemittanceMmk,
      totalSavingsSgd,
      totalSavingsMmk,
      cashInHandSgd,
      cashInHandMmk,
      portfolioCostSgd,
      portfolioCostMmk,
      portfolioValueSgd,
      portfolioValueMmk,
      portfolioProfitSgd,
      portfolioProfitMmk,
      portfolioProfitPct,
    };
  }, [transactions, holdings, vaultConfig.sgdToMmkRate]);

  const filteredHoldings = useMemo(() => {
    if (holdingFilter === 'all') return holdings;
    return holdings.filter((h) => h.assetType === holdingFilter);
  }, [holdings, holdingFilter]);

  // Calculator Handlers
  const handleCalcSgdChange = (val: string) => {
    setCalcSgd(val);
    const num = Math.max(0, parseFloat(val) || 0);
    setCalcLakhs(((num * metrics.rate) / 100000).toFixed(2));
  };

  const handleCalcLakhsChange = (val: string) => {
    setCalcLakhs(val);
    const numLakhs = Math.max(0, parseFloat(val) || 0);
    const sgdNeeded = metrics.rate > 0 ? (numLakhs * 100000) / metrics.rate : 0;
    setCalcSgd(sgdNeeded.toFixed(2));
  };

  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    transactions.forEach((tx) => {
      if (tx.date && tx.date.length >= 7) {
        monthSet.add(tx.date.slice(0, 7));
      }
    });
    return Array.from(monthSet).sort((a, b) => b.localeCompare(a));
  }, [transactions]);

  const latestTransactionDateStr = useMemo(() => {
    const valid = transactions
      .map((t) => t.date)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    return valid.length > 0 ? valid[valid.length - 1] : new Date().toISOString().slice(0, 10);
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    const q = txSearchQuery.trim().toLowerCase();
    const anchorMs = new Date(`${latestTransactionDateStr}T00:00:00`).getTime();
    const sevenDaysMs = 6 * 24 * 60 * 60 * 1000;

    return transactions.filter((tx) => {
      const matchesType = txFilter === 'all' ? true : tx.type === txFilter;
      if (!matchesType) return false;

      if (txSpecificDate) {
        if (tx.date !== txSpecificDate) return false;
      } else if (txMonthFilter === '7days') {
        const txMs = new Date(`${tx.date}T00:00:00`).getTime();
        if (Number.isNaN(txMs) || anchorMs - txMs > sevenDaysMs || txMs > anchorMs) {
          return false;
        }
      } else if (txMonthFilter !== 'all') {
        if (!tx.date || !tx.date.startsWith(txMonthFilter)) return false;
      }

      if (!q) return true;

      const catMeta = TRANSACTION_CATEGORIES.find((c) => c.labelEn === tx.category);
      const labelMm = catMeta ? catMeta.labelMm.toLowerCase() : '';
      return (
        (tx.title || '').toLowerCase().includes(q) ||
        (tx.category || '').toLowerCase().includes(q) ||
        labelMm.includes(q) ||
        (tx.note || '').toLowerCase().includes(q) ||
        (tx.recipientOrMerchant || '').toLowerCase().includes(q) ||
        (tx.date || '').toLowerCase().includes(q)
      );
    });
  }, [
    transactions,
    txFilter,
    txMonthFilter,
    txSpecificDate,
    txSearchQuery,
    latestTransactionDateStr,
  ]);

  // Group filteredTransactions by Date (YYYY-MM-DD, newest day first) for Daily Ledger & Daily Summary views
  const dailyTransactionGroups = useMemo(() => {
    const dayMap = new Map<
      string,
      {
        date: string;
        weekdayLabel: string;
        items: TransactionRecord[];
        incomeSgd: number;
        incomeMmk: number;
        expenseSgd: number;
        expenseMmk: number;
        savingsSgd: number;
        savingsMmk: number;
        remittanceSgd: number;
        remittanceMmk: number;
        outflowSgd: number;
        outflowMmk: number;
        netSgd: number;
        netMmk: number;
      }
    >();

    filteredTransactions.forEach((tx) => {
      const dateKey = tx.date || 'Unknown';
      let group = dayMap.get(dateKey);
      if (!group) {
        group = {
          date: dateKey,
          weekdayLabel: formatMyanmarDateWeekday(dateKey),
          items: [],
          incomeSgd: 0,
          incomeMmk: 0,
          expenseSgd: 0,
          expenseMmk: 0,
          savingsSgd: 0,
          savingsMmk: 0,
          remittanceSgd: 0,
          remittanceMmk: 0,
          outflowSgd: 0,
          outflowMmk: 0,
          netSgd: 0,
          netMmk: 0,
        };
        dayMap.set(dateKey, group);
      }
      group.items.push(tx);
      if (tx.type === 'income') {
        group.incomeSgd += tx.amountSgd;
        group.incomeMmk += tx.amountMmk;
      } else if (tx.type === 'savings') {
        group.savingsSgd += tx.amountSgd;
        group.savingsMmk += tx.amountMmk;
        group.outflowSgd += tx.amountSgd;
        group.outflowMmk += tx.amountMmk;
      } else if (tx.type === 'remittance') {
        group.remittanceSgd += tx.amountSgd;
        group.remittanceMmk += tx.amountMmk;
        group.outflowSgd += tx.amountSgd;
        group.outflowMmk += tx.amountMmk;
      } else {
        group.expenseSgd += tx.amountSgd;
        group.expenseMmk += tx.amountMmk;
        group.outflowSgd += tx.amountSgd;
        group.outflowMmk += tx.amountMmk;
      }
      group.netSgd = group.incomeSgd - group.outflowSgd;
      group.netMmk = Math.round(group.netSgd * metrics.rate);
    });

    return Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredTransactions, metrics.rate]);

  // Recent 3 days across all transactions for the Overview quick glance
  const recentOverviewDayGroups = useMemo(() => {
    const dayMap = new Map<
      string,
      {
        date: string;
        weekdayLabel: string;
        items: TransactionRecord[];
        outflowSgd: number;
        incomeSgd: number;
      }
    >();

    transactions.forEach((tx) => {
      const dateKey = tx.date || 'Unknown';
      let g = dayMap.get(dateKey);
      if (!g) {
        g = {
          date: dateKey,
          weekdayLabel: formatMyanmarDateWeekday(dateKey),
          items: [],
          outflowSgd: 0,
          incomeSgd: 0,
        };
        dayMap.set(dateKey, g);
      }
      g.items.push(tx);
      if (tx.type === 'income') {
        g.incomeSgd += tx.amountSgd;
      } else {
        g.outflowSgd += tx.amountSgd;
      }
    });

    return Array.from(dayMap.values())
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3);
  }, [transactions]);

  // လက်ရှိ စာရင်း အနှစ်ချုပ် (Current Filtered Transactions Summary)
  const filteredCashflowSummary = useMemo(() => {
    let incomeSgd = 0;
    let incomeMmk = 0;
    let expenseSgd = 0;
    let expenseMmk = 0;
    let savingsSgd = 0;
    let savingsMmk = 0;
    let remittanceSgd = 0;
    let remittanceMmk = 0;

    filteredTransactions.forEach((tx) => {
      if (tx.type === 'income') {
        incomeSgd += tx.amountSgd;
        incomeMmk += tx.amountMmk;
      } else if (tx.type === 'savings') {
        savingsSgd += tx.amountSgd;
        savingsMmk += tx.amountMmk;
      } else if (tx.type === 'remittance') {
        remittanceSgd += tx.amountSgd;
        remittanceMmk += tx.amountMmk;
      } else {
        expenseSgd += tx.amountSgd;
        expenseMmk += tx.amountMmk;
      }
    });

    const netSgd = incomeSgd - expenseSgd - remittanceSgd - savingsSgd;
    const netMmk = Math.round(netSgd * metrics.rate);
    const dayCount = dailyTransactionGroups.length;
    const avgDailyExpenseSgd = dayCount > 0 ? expenseSgd / dayCount : 0;

    return {
      count: filteredTransactions.length,
      dayCount,
      avgDailyExpenseSgd,
      incomeSgd,
      incomeMmk,
      expenseSgd,
      expenseMmk,
      savingsSgd,
      savingsMmk,
      remittanceSgd,
      remittanceMmk,
      netSgd,
      netMmk,
    };
  }, [filteredTransactions, dailyTransactionGroups.length, metrics.rate]);

  // Weekly / Monthly / Yearly Expense Category Distribution for Recharts BarChart
  const expenseChartSummary = useMemo(() => {
    const validDates = transactions
      .map((t) => t.date)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();

    const anchorDateStr =
      validDates.length > 0
        ? validDates[validDates.length - 1]
        : new Date().toISOString().slice(0, 10);

    const anchorTime = new Date(`${anchorDateStr}T00:00:00`).getTime();
    const anchorMonth = anchorDateStr.slice(0, 7);
    const anchorYear = anchorDateStr.slice(0, 4);

    const categoryMap = new Map<
      string,
      {
        category: string;
        shortLabel: string;
        labelMm: string;
        amountSgd: number;
        amountMmk: number;
        count: number;
        isRemittance: boolean;
      }
    >();

    let periodTotalSgd = 0;
    let periodTotalMmk = 0;

    transactions.forEach((tx) => {
      const isIncludedType =
        tx.type === 'expense' || (includeRemittanceInChart && tx.type === 'remittance');
      if (!isIncludedType) return;

      const txDateStr = tx.date || '';
      let matchesPeriod = false;

      if (expensePeriod === 'weekly') {
        const txTime = new Date(`${txDateStr}T00:00:00`).getTime();
        if (!Number.isNaN(txTime) && !Number.isNaN(anchorTime)) {
          const diffDays = (anchorTime - txTime) / (1000 * 60 * 60 * 24);
          matchesPeriod = diffDays >= 0 && diffDays < 7;
        }
      } else if (expensePeriod === 'monthly') {
        matchesPeriod = txDateStr.slice(0, 7) === anchorMonth;
      } else {
        matchesPeriod = txDateStr.slice(0, 4) === anchorYear;
      }

      if (!matchesPeriod) return;

      const catKey = tx.category || 'Other';
      const foundMeta = TRANSACTION_CATEGORIES.find((c) => c.labelEn === catKey);
      const labelMm = foundMeta ? foundMeta.labelMm : catKey;
      const shortLabel = labelMm.split(' (')[0].slice(0, 18);

      const existing = categoryMap.get(catKey);
      if (existing) {
        existing.amountSgd = Number((existing.amountSgd + tx.amountSgd).toFixed(2));
        existing.amountMmk += tx.amountMmk;
        existing.count += 1;
      } else {
        categoryMap.set(catKey, {
          category: catKey,
          shortLabel,
          labelMm,
          amountSgd: Number(tx.amountSgd.toFixed(2)),
          amountMmk: tx.amountMmk,
          count: 1,
          isRemittance: tx.type === 'remittance',
        });
      }

      periodTotalSgd += tx.amountSgd;
      periodTotalMmk += tx.amountMmk;
    });

    const data = Array.from(categoryMap.values())
      .sort((a, b) => b.amountSgd - a.amountSgd)
      .map((item) => ({
        ...item,
        sharePct: periodTotalSgd > 0 ? Math.round((item.amountSgd / periodTotalSgd) * 100) : 0,
      }));

    const periodLabel =
      expensePeriod === 'weekly'
        ? `ရက်သတ္တပတ် (${anchorDateStr} အထိ ၇ ရက်)`
        : expensePeriod === 'monthly'
        ? `လစဉ် (${anchorMonth})`
        : `နှစ်စဉ် (${anchorYear})`;

    return {
      data,
      periodTotalSgd,
      periodTotalMmk,
      periodLabel,
    };
  }, [transactions, expensePeriod, includeRemittanceInChart]);

  // CRUD Handlers — Instant 0ms Optimistic State & LocalStorage Updates + Background Cloud Sync
  const handleSaveTransaction = async (
    txPayload: Omit<TransactionRecord, 'id' | 'ownerId'>
  ) => {
    const isEdit = Boolean(editingTx);
    const txId = editingTx
      ? editingTx.id
      : `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ownerId = currentUser ? currentUser.uid : 'local_user';

    const nextRecord: TransactionRecord = {
      id: txId,
      ownerId,
      ...txPayload,
    };

    deletedIdsRef.current.delete(txId);
    localUpdatedTxRef.current.set(txId, nextRecord);

    // 1. Update local state & localStorage IMMEDIATELY (0ms latency, instant recalculation)
    setTransactions((prev) => {
      const updated = isEdit
        ? prev.map((item) => (item.id === txId ? nextRecord : item))
        : [nextRecord, ...prev];
      const sorted = [...updated].sort((a, b) => b.date.localeCompare(a.date));
      try {
        localStorage.setItem('merlion_transactions_v1', JSON.stringify(sorted));
      } catch {
        // ignore
      }
      return sorted;
    });

    setEditingTx(null);
    showToast(isEdit ? 'စာရင်းပြင်ဆင်ပြီးပါပြီ' : 'စာရင်းသိမ်းပြီးပါပြီ');

    // 2. Sync to Firestore asynchronously in background if signed in
    if (currentUser) {
      const path = `users/${currentUser.uid}/transactions/${txId}`;
      const txRef = doc(db, 'users', currentUser.uid, 'transactions', txId);
      const writePromise = isEdit
        ? updateDoc(txRef, {
            type: txPayload.type,
            category: txPayload.category,
            title: txPayload.title,
            amountSgd: txPayload.amountSgd,
            exchangeRateUsed: txPayload.exchangeRateUsed,
            amountMmk: txPayload.amountMmk,
            date: txPayload.date,
            recipientOrMerchant: txPayload.recipientOrMerchant,
            note: txPayload.note,
            updatedAt: serverTimestamp(),
          })
        : setDoc(txRef, {
            ownerId: currentUser.uid,
            ...txPayload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

      writePromise.catch((err) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        try {
          handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
        } catch {
          // ignore background sync error when offline
        }
      });
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    deletedIdsRef.current.add(id);
    localUpdatedTxRef.current.delete(id);
    try {
      localStorage.setItem(
        'merlion_deleted_ids_v1',
        JSON.stringify(Array.from(deletedIdsRef.current))
      );
    } catch {
      // ignore
    }

    // 1. Remove from local state & localStorage IMMEDIATELY
    setTransactions((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      try {
        localStorage.setItem('merlion_transactions_v1', JSON.stringify(filtered));
      } catch {
        // ignore
      }
      return filtered;
    });
    showToast('ဖျက်ပြီးပါပြီ');

    // 2. Delete from Firestore in background if signed in
    if (currentUser) {
      const path = `users/${currentUser.uid}/transactions/${id}`;
      deleteDoc(doc(db, 'users', currentUser.uid, 'transactions', id)).catch((err) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        try {
          handleFirestoreError(err, OperationType.DELETE, path);
        } catch {
          // ignore background sync error
        }
      });
    }
  };

  const handleSaveHolding = async (
    holdingPayload: Omit<HoldingRecord, 'id' | 'ownerId'>
  ) => {
    const isEdit = Boolean(editingHolding);
    const holdId = editingHolding
      ? editingHolding.id
      : `hold_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ownerId = currentUser ? currentUser.uid : 'local_user';

    const nextHolding: HoldingRecord = {
      id: holdId,
      ownerId,
      ...holdingPayload,
    };

    deletedIdsRef.current.delete(holdId);
    localUpdatedHoldRef.current.set(holdId, nextHolding);

    // 1. Update local state & localStorage IMMEDIATELY (0ms latency, instant portfolio calculation)
    setHoldings((prev) => {
      const updated = isEdit
        ? prev.map((h) => (h.id === holdId ? nextHolding : h))
        : [nextHolding, ...prev];
      try {
        localStorage.setItem('merlion_holdings_v1', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });

    setEditingHolding(null);
    showToast(isEdit ? 'စာရင်းပြင်ဆင်ပြီးပါပြီ' : 'သိမ်းပြီးပါပြီ');

    // 2. Sync to Firestore asynchronously in background if signed in
    if (currentUser) {
      const path = `users/${currentUser.uid}/holdings/${holdId}`;
      const holdRef = doc(db, 'users', currentUser.uid, 'holdings', holdId);
      const writePromise = isEdit
        ? updateDoc(holdRef, {
            assetType: holdingPayload.assetType,
            symbol: holdingPayload.symbol,
            name: holdingPayload.name,
            quantity: holdingPayload.quantity,
            avgBuyPriceSgd: holdingPayload.avgBuyPriceSgd,
            currentPriceSgd: holdingPayload.currentPriceSgd,
            platform: holdingPayload.platform,
            note: holdingPayload.note,
            updatedAt: serverTimestamp(),
          })
        : setDoc(holdRef, {
            ownerId: currentUser.uid,
            ...holdingPayload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

      writePromise.catch((err) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        try {
          handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
        } catch {
          // ignore background sync error
        }
      });
    }
  };

  const handleDeleteHolding = async (id: string) => {
    deletedIdsRef.current.add(id);
    localUpdatedHoldRef.current.delete(id);
    try {
      localStorage.setItem(
        'merlion_deleted_ids_v1',
        JSON.stringify(Array.from(deletedIdsRef.current))
      );
    } catch {
      // ignore
    }

    // 1. Remove from local state & localStorage IMMEDIATELY
    setHoldings((prev) => {
      const filtered = prev.filter((h) => h.id !== id);
      try {
        localStorage.setItem('merlion_holdings_v1', JSON.stringify(filtered));
      } catch {
        // ignore
      }
      return filtered;
    });
    showToast('ဖျက်ပြီးပါပြီ');

    // 2. Delete from Firestore in background if signed in
    if (currentUser) {
      const path = `users/${currentUser.uid}/holdings/${id}`;
      deleteDoc(doc(db, 'users', currentUser.uid, 'holdings', id)).catch((err) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        try {
          handleFirestoreError(err, OperationType.DELETE, path);
        } catch {
          // ignore background sync error
        }
      });
    }
  };

  const handleSaveExchangeRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextRate = Math.max(100, Math.min(100000, Number(rateDraft) || 3380));

    // 1. Update local state & calculator IMMEDIATELY
    setVaultConfig((prev) => {
      const updated = { ...prev, sgdToMmkRate: nextRate };
      try {
        localStorage.setItem('merlion_vault_config_v1', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
    const currentSgdNum = parseFloat(calcSgd) || 0;
    setCalcLakhs(((currentSgdNum * nextRate) / 100000).toFixed(2));
    setIsEditingRate(false);
    showToast(`1 SGD = ${nextRate.toLocaleString()} MMK သိမ်းပြီးပါပြီ`);

    // 2. Sync to Firestore in background if signed in
    if (currentUser) {
      const path = `vaultConfigs/${currentUser.uid}`;
      updateDoc(doc(db, 'vaultConfigs', currentUser.uid), {
        sgdToMmkRate: nextRate,
        bankOfficialRate: vaultConfig.bankOfficialRate,
        monthlySalarySgd: vaultConfig.monthlySalarySgd,
        monthlyRentSgd: vaultConfig.monthlyRentSgd,
        monthlySavingsTargetSgd: vaultConfig.monthlySavingsTargetSgd,
        updatedAt: serverTimestamp(),
      }).catch((err) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        try {
          handleFirestoreError(err, OperationType.UPDATE, path);
        } catch {
          // ignore background sync error
        }
      });
    }
  };

  const handleRefreshLiveBtc = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('အင်တာနက်မရှိသော်လည်း သိမ်းထားသော ပေါက်ဈေးဖြင့် တွက်ချက်ထားပါသည်');
      return;
    }
    setIsRefreshingMarket(true);
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=sgd'
      );
      if (res.ok) {
        const data = await res.json();
        const rawBtc = Number(data?.bitcoin?.sgd);
        if (rawBtc > 0) {
          const clampedPrice = Math.min(100000000, rawBtc);
          let updatedAny = false;
          setHoldings((prev) => {
            const nextList = prev.map((item) => {
              if (item.symbol.toUpperCase() === 'BTC') {
                updatedAny = true;
                const updatedItem = { ...item, currentPriceSgd: clampedPrice };
                localUpdatedHoldRef.current.set(item.id, updatedItem);
                return updatedItem;
              }
              return item;
            });
            try {
              localStorage.setItem('merlion_holdings_v1', JSON.stringify(nextList));
            } catch {
              // ignore
            }
            return nextList;
          });

          if (currentUser) {
            for (const h of holdings) {
              if (h.symbol.toUpperCase() === 'BTC') {
                const path = `users/${currentUser.uid}/holdings/${h.id}`;
                updateDoc(doc(db, 'users', currentUser.uid, 'holdings', h.id), {
                  currentPriceSgd: clampedPrice,
                  updatedAt: serverTimestamp(),
                }).catch((err) => {
                  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
                  try {
                    handleFirestoreError(err, OperationType.UPDATE, path);
                  } catch {
                    // ignore
                  }
                });
              }
            }
          }
          showToast(
            updatedAny
              ? `BTC ပေါက်ဈေး (${formatSgd(clampedPrice)}) ရယူပြီးပါပြီ`
              : `လက်ရှိ BTC ပေါက်ဈေးမှာ ${formatSgd(clampedPrice)} ဖြစ်ပါသည်`
          );
          return;
        }
      }
      showToast('လက်ရှိ သိမ်းထားသော ပေါက်ဈေးကို သုံးထားပါသည်');
    } catch {
      showToast('လက်ရှိ သိမ်းထားသော ပေါက်ဈေးကို သုံးထားပါသည်');
    } finally {
      setIsRefreshingMarket(false);
    }
  };

  // =========================================================================
  // MANUAL BACKUP (JSON & CSV EXPORT) & RESTORE (JSON IMPORT) HANDLERS
  // =========================================================================
  const handleExportJsonBackup = () => {
    const backupPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      vaultConfig: {
        sgdToMmkRate: vaultConfig.sgdToMmkRate,
        bankOfficialRate: vaultConfig.bankOfficialRate,
        monthlySalarySgd: vaultConfig.monthlySalarySgd,
        monthlyRentSgd: vaultConfig.monthlyRentSgd,
        monthlySavingsTargetSgd: vaultConfig.monthlySavingsTargetSgd,
        biometricEnabled: vaultConfig.biometricEnabled,
        passkeyId: vaultConfig.passkeyId,
        pinCode: vaultConfig.pinCode,
        autoLockMinutes: vaultConfig.autoLockMinutes,
      },
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        category: tx.category,
        title: tx.title,
        amountSgd: tx.amountSgd,
        exchangeRateUsed: tx.exchangeRateUsed,
        amountMmk: tx.amountMmk,
        date: tx.date,
        recipientOrMerchant: tx.recipientOrMerchant,
        note: tx.note || '',
      })),
      holdings: holdings.map((h) => ({
        id: h.id,
        assetType: h.assetType,
        symbol: h.symbol,
        name: h.name,
        quantity: h.quantity,
        avgBuyPriceSgd: h.avgBuyPriceSgd,
        currentPriceSgd: h.currentPriceSgd,
        platform: h.platform,
        note: h.note || '',
      })),
    };

    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `uchsar-pwar-backup-${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Backup (.json) ဖိုင် ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ');
  };

  const handleExportCsv = () => {
    const headers = [
      'Date',
      'Type',
      'Category',
      'Description',
      'Amount_SGD',
      'Exchange_Rate',
      'Amount_MMK',
      'Recipient_Merchant',
      'Note',
    ];
    const rows = transactions.map((tx) => [
      tx.date,
      tx.type,
      `"${(tx.category || '').replace(/"/g, '""')}"`,
      `"${(tx.title || '').replace(/"/g, '""')}"`,
      tx.amountSgd,
      tx.exchangeRateUsed,
      tx.amountMmk,
      `"${(tx.recipientOrMerchant || '').replace(/"/g, '""')}"`,
      `"${(tx.note || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `uchsar-pwar-records-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Excel (.csv) စာရင်းဖိုင် ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ');
  };

  const handleRestoreFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorBanner(null);
    setIsRestoringBackup(true);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (
        !parsed ||
        typeof parsed !== 'object' ||
        (!Array.isArray(parsed.transactions) && !Array.isArray(parsed.holdings))
      ) {
        throw new Error('မှန်ကန်သော Backup (.json) ဖိုင် မဟုတ်ပါ။');
      }

      const ownerId = currentUser ? currentUser.uid : 'local_user';
      const fallbackDate = new Date().toISOString().slice(0, 10);

      const restoredTransactions: TransactionRecord[] = Array.isArray(parsed.transactions)
        ? parsed.transactions.map((t: Record<string, unknown>, idx: number) => {
            const rawId =
              String(t.id || `tx_restored_${Date.now()}_${idx}`)
                .replace(/[^a-zA-Z0-9_-]/g, '_')
                .slice(0, 100) || `tx_restored_${Date.now()}_${idx}`;
            const sgd = Math.min(100000000, Math.max(0, Number(t.amountSgd) || 0));
            const rate = Math.min(100000, Math.max(1, Number(t.exchangeRateUsed) || 3380));
            const rawMmk = Number(t.amountMmk) || sgd * rate;
            const mmk = Math.min(1000000000000, Math.max(0, Math.round(rawMmk)));
            const candidateDate = String(t.date || '').trim();
            const validDate =
              candidateDate.length >= 8 ? candidateDate.slice(0, 20) : fallbackDate;

            return {
              id: rawId,
              ownerId,
              type:
                t.type === 'income' || t.type === 'remittance' || t.type === 'savings'
                  ? t.type
                  : 'expense',
              category: (String(t.category || '').trim() || 'Other').slice(0, 60),
              title: (String(t.title || '').trim() || 'Restored Entry').slice(0, 120),
              amountSgd: sgd,
              exchangeRateUsed: rate,
              amountMmk: mmk,
              date: validDate,
              recipientOrMerchant: String(t.recipientOrMerchant || 'Singapore').slice(
                0,
                100
              ),
              note: String(t.note || '').slice(0, 300),
            };
          })
        : [];

      const restoredHoldings: HoldingRecord[] = Array.isArray(parsed.holdings)
        ? parsed.holdings.map((h: Record<string, unknown>, idx: number) => {
            const rawId =
              String(h.id || `hold_restored_${Date.now()}_${idx}`)
                .replace(/[^a-zA-Z0-9_-]/g, '_')
                .slice(0, 100) || `hold_restored_${Date.now()}_${idx}`;
            return {
              id: rawId,
              ownerId,
              assetType:
                h.assetType === 'crypto' || h.assetType === 'etf'
                  ? h.assetType
                  : 'stock',
              symbol: (String(h.symbol || '').trim().toUpperCase() || 'ASSET').slice(0, 30),
              name: (String(h.name || '').trim() || 'Restored Asset').slice(0, 100),
              quantity: Math.min(1000000000, Math.max(0.00000001, Number(h.quantity) || 1)),
              avgBuyPriceSgd: Math.min(100000000, Math.max(0, Number(h.avgBuyPriceSgd) || 0)),
              currentPriceSgd: Math.min(100000000, Math.max(0, Number(h.currentPriceSgd) || 0)),
              platform: (String(h.platform || '').trim() || 'Moomoo SG').slice(0, 80),
              note: String(h.note || '').slice(0, 240),
            };
          })
        : [];

      const nextRate = Math.max(
        100,
        Math.min(
          100000,
          Number(parsed.vaultConfig?.sgdToMmkRate) || vaultConfig.sgdToMmkRate || 3380
        )
      );
      const nextBankRate = Math.max(
        1,
        Math.min(100000, Number(parsed.vaultConfig?.bankOfficialRate) || 2960)
      );
      const nextSalary = Math.max(
        0,
        Math.min(10000000, Number(parsed.vaultConfig?.monthlySalarySgd) || 5800)
      );
      const nextRent = Math.max(
        0,
        Math.min(10000000, Number(parsed.vaultConfig?.monthlyRentSgd) || 1150)
      );
      const nextSavingsTarget = Math.max(
        0,
        Math.min(10000000, Number(parsed.vaultConfig?.monthlySavingsTargetSgd) || 1800)
      );

      // 1. Update local state & localStorage IMMEDIATELY (0ms latency)
      setVaultConfig((prev) => {
        const updated = {
          ...prev,
          sgdToMmkRate: nextRate,
          bankOfficialRate: nextBankRate,
          monthlySalarySgd: nextSalary,
          monthlyRentSgd: nextRent,
          monthlySavingsTargetSgd: nextSavingsTarget,
        };
        try {
          localStorage.setItem('merlion_vault_config_v1', JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });

      if (restoredTransactions.length > 0) {
        restoredTransactions.forEach((tx) => {
          deletedIdsRef.current.delete(tx.id);
          localUpdatedTxRef.current.set(tx.id, tx);
        });
        const sortedTx = [...restoredTransactions].sort((a, b) => b.date.localeCompare(a.date));
        setTransactions(sortedTx);
        try {
          localStorage.setItem('merlion_transactions_v1', JSON.stringify(sortedTx));
        } catch {
          // ignore
        }
      }

      if (restoredHoldings.length > 0) {
        restoredHoldings.forEach((h) => {
          deletedIdsRef.current.delete(h.id);
          localUpdatedHoldRef.current.set(h.id, h);
        });
        setHoldings(restoredHoldings);
        try {
          localStorage.setItem('merlion_holdings_v1', JSON.stringify(restoredHoldings));
        } catch {
          // ignore
        }
      }

      showToast(
        `Backup ဖိုင်မှ စာရင်း (${restoredTransactions.length}) ခု နှင့် ရင်းနှီးမြှုပ်နှံမှု (${restoredHoldings.length}) ခု ပြန်တင်ပြီးပါပြီ`
      );

      // 2. Sync to Firestore in background if signed in
      if (currentUser) {
        const uid = currentUser.uid;
        (async () => {
          try {
            const configRef = doc(db, 'vaultConfigs', uid);
            await updateDoc(configRef, {
              sgdToMmkRate: nextRate,
              bankOfficialRate: nextBankRate,
              monthlySalarySgd: nextSalary,
              monthlyRentSgd: nextRent,
              monthlySavingsTargetSgd: nextSavingsTarget,
              updatedAt: serverTimestamp(),
            });

            const existingTxIds = new Set(transactions.map((t) => t.id));
            for (const tx of restoredTransactions) {
              const txRef = doc(db, 'users', uid, 'transactions', tx.id);
              if (existingTxIds.has(tx.id)) {
                await updateDoc(txRef, {
                  type: tx.type,
                  category: tx.category,
                  title: tx.title,
                  amountSgd: tx.amountSgd,
                  exchangeRateUsed: tx.exchangeRateUsed,
                  amountMmk: tx.amountMmk,
                  date: tx.date,
                  recipientOrMerchant: tx.recipientOrMerchant,
                  note: tx.note,
                  updatedAt: serverTimestamp(),
                });
              } else {
                await setDoc(txRef, {
                  ownerId: uid,
                  type: tx.type,
                  category: tx.category,
                  title: tx.title,
                  amountSgd: tx.amountSgd,
                  exchangeRateUsed: tx.exchangeRateUsed,
                  amountMmk: tx.amountMmk,
                  date: tx.date,
                  recipientOrMerchant: tx.recipientOrMerchant,
                  note: tx.note,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              }
            }

            const existingHoldIds = new Set(holdings.map((h) => h.id));
            for (const h of restoredHoldings) {
              const holdRef = doc(db, 'users', uid, 'holdings', h.id);
              if (existingHoldIds.has(h.id)) {
                await updateDoc(holdRef, {
                  assetType: h.assetType,
                  symbol: h.symbol,
                  name: h.name,
                  quantity: h.quantity,
                  avgBuyPriceSgd: h.avgBuyPriceSgd,
                  currentPriceSgd: h.currentPriceSgd,
                  platform: h.platform,
                  note: h.note,
                  updatedAt: serverTimestamp(),
                });
              } else {
                await setDoc(holdRef, {
                  ownerId: uid,
                  assetType: h.assetType,
                  symbol: h.symbol,
                  name: h.name,
                  quantity: h.quantity,
                  avgBuyPriceSgd: h.avgBuyPriceSgd,
                  currentPriceSgd: h.currentPriceSgd,
                  platform: h.platform,
                  note: h.note,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              }
            }
          } catch {
            // ignore background sync errors when offline
          }
        })();
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Backup ဖိုင် ပြန်တင်ရာတွင် အမှားရှိနေပါသည်။'
      );
    } finally {
      setIsRestoringBackup(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRegisterPasskey = async () => {
    const uid = currentUser?.uid || 'local_sg_owner';
    const email = currentUser?.email || 'sg-user@merlionvault.app';
    const result = await registerBiometricPasskey(uid, email);
    const nextPasskeyId = result.credentialId.slice(0, 256);

    setVaultConfig((prev) => {
      const updated = {
        ...prev,
        biometricEnabled: true,
        passkeyId: nextPasskeyId,
      };
      try {
        localStorage.setItem('merlion_vault_config_v1', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
    showToast('Biometric ချိတ်ဆက်ပြီးပါပြီ');

    if (currentUser) {
      const path = `vaultConfigs/${currentUser.uid}`;
      updateDoc(doc(db, 'vaultConfigs', currentUser.uid), {
        biometricEnabled: true,
        passkeyId: nextPasskeyId,
        pinCode: (vaultConfig.pinCode || '2026').slice(0, 64),
        autoLockMinutes: Math.max(1, Math.min(1440, Number(autoLockDraft) || 15)),
        updatedAt: serverTimestamp(),
      }).catch((err) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        try {
          handleFirestoreError(err, OperationType.UPDATE, path);
        } catch {
          // ignore
        }
      });
    }
  };

  const handleSaveSecuritySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecurityFormError(null);

    const activePin = vaultConfig.pinCode || '2026';
    const cleanCurrentPin = currentPinDraft.replace(/[^0-9]/g, '');
    const cleanNewPin = pinDraft.replace(/[^0-9]/g, '');
    const sanitizedMinutes = Math.max(1, Math.min(1440, Number(autoLockDraft) || 15));

    let nextPinToSave = activePin;

    // If user is attempting to change the PIN, verify current PIN and new PIN length
    if (cleanNewPin.length > 0 || cleanCurrentPin.length > 0) {
      if (cleanCurrentPin !== activePin) {
        setSecurityFormError('လက်ရှိ PIN နံပါတ် မှားယွင်းနေပါသည်။');
        return;
      }
      if (cleanNewPin.length < 4 || cleanNewPin.length > 6) {
        setSecurityFormError('PIN အသစ်သည် ဂဏန်း ၄ လုံးမှ ၆ လုံးအတွင်း ဖြစ်ရပါမည်။');
        return;
      }
      nextPinToSave = cleanNewPin;
    }

    // 1. Update local state & localStorage IMMEDIATELY
    setVaultConfig((prev) => {
      const updated = {
        ...prev,
        pinCode: nextPinToSave,
        autoLockMinutes: sanitizedMinutes,
      };
      try {
        localStorage.setItem('merlion_vault_config_v1', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });

    setCurrentPinDraft('');
    setPinDraft('');
    try {
      localStorage.removeItem('uchsar_pin_security_state_v1');
    } catch {
      // ignore
    }
    showToast(
      cleanNewPin.length > 0
        ? 'PIN နံပါတ်အသစ်နှင့် လုံခြုံရေးချိန်ညှိချက် သိမ်းပြီးပါပြီ'
        : 'Auto-Lock အချိန် သိမ်းပြီးပါပြီ'
    );

    // 2. Sync to Firestore in background if signed in
    if (currentUser) {
      const path = `vaultConfigs/${currentUser.uid}`;
      updateDoc(doc(db, 'vaultConfigs', currentUser.uid), {
        biometricEnabled: vaultConfig.biometricEnabled,
        passkeyId: vaultConfig.passkeyId || 'sim_bio_default',
        pinCode: nextPinToSave,
        autoLockMinutes: sanitizedMinutes,
        updatedAt: serverTimestamp(),
      }).catch((err) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        try {
          handleFirestoreError(err, OperationType.UPDATE, path);
        } catch {
          // ignore
        }
      });
    }
  };

  if (isVaultLocked) {
    return (
      <BiometricLockScreen
        passkeyId={vaultConfig.passkeyId}
        pinCode={vaultConfig.pinCode}
        biometricEnabled={vaultConfig.biometricEnabled}
        userEmail={currentUser?.email}
        isDark={isDark}
        onToggleTheme={() => setIsDark((d) => !d)}
        onUnlock={handleUnlockVault}
      />
    );
  }

  return (
    <div className={isDark ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pb-24 md:pb-12 transition-colors">
        {/* Smart 3-Zone Top Bar */}
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800">
          <div className="max-w-5xl w-full mx-auto flex items-center justify-between gap-3 sm:gap-6 px-4 sm:px-6 h-16">
            {/* Zone 1: Brand with Application Icon */}
            <a
              href="#overview"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('overview');
              }}
              className="flex items-center gap-2.5 text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 min-w-0"
            >
              <span className="w-9 h-9 aspect-square rounded-xl overflow-hidden bg-[#073b4c] p-0.5 shrink-0 inline-flex items-center justify-center shadow-xs">
                <img
                  src="./assets/aistudio/my_walet_40feb1c8.png"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.dataset.fallback) {
                      img.dataset.fallback = '1';
                      img.src =
                        './public/assets/aistudio/my_walet_40feb1c8.png';
                    }
                  }}
                  alt="ဥစ္စာပွား (Uchsar Pwar)"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain object-center"
                />
              </span>
              <span className="truncate">ဥစ္စာပွား</span>
              <span className="hidden lg:inline text-xs font-medium text-slate-400 dark:text-slate-500">
                (Uchsar Pwar)
              </span>
              {!isOnline && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                  Offline
                </span>
              )}
            </a>

            {/* Zone 2: 4 Clean Navigation Links (Tablet/Desktop) */}
            <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-sm font-medium text-slate-500 dark:text-slate-400">
              <a
                href="#overview"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection('overview');
                }}
                className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 ${
                  activeSection === 'overview'
                    ? 'text-emerald-600 dark:text-emerald-400 font-bold underline underline-offset-8 decoration-2'
                    : ''
                }`}
              >
                ပင်မ
              </a>
              <a
                href="#cashflow"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection('cashflow');
                }}
                className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 ${
                  activeSection === 'cashflow'
                    ? 'text-emerald-600 dark:text-emerald-400 font-bold underline underline-offset-8 decoration-2'
                    : ''
                }`}
              >
                ဝင်ငွေ / အသုံးစရိတ်
              </a>
              <a
                href="#portfolio"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection('portfolio');
                }}
                className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 ${
                  activeSection === 'portfolio'
                    ? 'text-emerald-600 dark:text-emerald-400 font-bold underline underline-offset-8 decoration-2'
                    : ''
                }`}
              >
                စတော့ / Bitcoin
              </a>
              <a
                href="#settings"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection('settings');
                }}
                className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 ${
                  activeSection === 'settings'
                    ? 'text-emerald-600 dark:text-emerald-400 font-bold underline underline-offset-8 decoration-2'
                    : ''
                }`}
              >
                ဆက်တင် (Backup)
              </a>
            </nav>

            {/* Zone 3: Unified Smart Utility Dock (Search, Day/Night, Lock) */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/90 border border-slate-200/70 dark:border-slate-700/70 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (activeSection !== 'overview') {
                    setActiveSection('overview');
                    setIsOverviewSearchOpen(true);
                  } else {
                    setIsOverviewSearchOpen((prev) => !prev);
                  }
                }}
                aria-label="Search and filter transactions"
                title="စာရင်းရှာဖွေရန်နှင့် စစ်ထုတ်ရန်"
                className={`h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isOverviewSearchOpen && activeSection === 'overview'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-900'
                }`}
              >
                <Search className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">ရှာရန်</span>
              </button>

              <button
                type="button"
                onClick={() => setIsDark((prev) => !prev)}
                aria-label="Toggle Day/Night Mode"
                title={isDark ? 'Switch to Day Mode' : 'Switch to Night Mode'}
                className="h-8 px-2.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-900 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isDark ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="hidden sm:inline">Day</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                    <span className="hidden sm:inline">Night</span>
                  </>
                )}
              </button>

              {!isStandaloneApp && (
                <button
                  type="button"
                  onClick={handleInstallAppClick}
                  aria-label="Install app on phone"
                  title="ဖုန်းတွင် Application Icon ဖြင့် သွင်းရန်"
                  className="h-8 px-2.5 rounded-lg text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50/90 dark:bg-emerald-950/70 hover:bg-emerald-100 dark:hover:bg-emerald-900/80 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Smartphone className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="hidden sm:inline">App သွင်းရန်</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsVaultLocked(true)}
                aria-label="Lock application"
                title="သော့ခတ်ရန်"
                className="h-8 px-2.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-900 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="hidden sm:inline">Lock</span>
              </button>
            </div>
          </div>
        </header>

        {/* Focused, Responsive Workspace Container */}
        <main className="max-w-5xl w-full mx-auto px-4 sm:px-6 pt-5 sm:pt-6 flex-1 space-y-5">
          {toastMessage && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {errorBanner && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-200 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorBanner}</span>
            </div>
          )}

          {/* =========================================================
              TAB 1: ပင်မ (Smart, Responsive Overview)
             ========================================================= */}
          {activeSection === 'overview' && (
            <div className="space-y-5">
              {/* Collapsible Search & Filter Panel in ပင်မ Tab (Triggered via Search Icon) */}
              {isOverviewSearchOpen && (
                <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Search className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        စာရင်းရှာဖွေရန် နှင့် စစ်ထုတ်ရန်
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsOverviewSearchOpen(false)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer shrink-0"
                      aria-label="Close search panel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      autoFocus
                      value={txSearchQuery}
                      onChange={(e) => setTxSearchQuery(e.target.value)}
                      placeholder="ခေါင်းစဉ်၊ အမျိုးအစား သို့မဟုတ် မှတ်ချက် (Note) ဖြင့် ရှာဖွေရန်..."
                      className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-10 pr-10 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                    />
                    {txSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setTxSearchQuery('')}
                        aria-label="Clear search"
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Filter Tabs */}
                  <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl overflow-x-auto">
                    {(
                      [
                        { id: 'all', label: 'အားလုံး' },
                        { id: 'expense', label: 'အသုံးစရိတ်' },
                        { id: 'savings', label: 'စုငွေ' },
                        { id: 'remittance', label: 'အိမ်ပို့ငွေ' },
                        { id: 'income', label: 'ဝင်ငွေ' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setTxFilter(tab.id)}
                        className={`min-h-[34px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          txFilter === tab.id
                            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* လက်ရှိ စာရင်း အနှစ်ချုပ် (Current Filtered Summary) */}
                  <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        လက်ရှိ စာရင်း အနှစ်ချုပ်
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        စာရင်းအရေအတွက်:{' '}
                        <span className="font-mono-tabular font-bold text-slate-900 dark:text-slate-100">
                          {filteredCashflowSummary.count}
                        </span>{' '}
                        ခု
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                      <div className="min-w-0">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">ဝင်ငွေ</div>
                        <div className="mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold text-emerald-600 dark:text-emerald-400 truncate">
                          +{formatSgd(filteredCashflowSummary.incomeSgd)}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">အသုံးစရိတ်</div>
                        <div className="mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                          -{formatSgd(filteredCashflowSummary.expenseSgd)}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">စုငွေ</div>
                        <div className="mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold text-sky-600 dark:text-sky-400 truncate">
                          {formatSgd(filteredCashflowSummary.savingsSgd)}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">အိမ်ပို့ငွေ</div>
                        <div className="mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold text-amber-600 dark:text-amber-400 truncate">
                          -{formatSgd(filteredCashflowSummary.remittanceSgd)}
                        </div>
                      </div>

                      <div className="min-w-0 col-span-2 sm:col-span-1">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">အသားတင်</div>
                        <div
                          className={`mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold truncate ${
                            filteredCashflowSummary.netSgd >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {filteredCashflowSummary.netSgd >= 0 ? '+' : ''}
                          {formatSgd(filteredCashflowSummary.netSgd)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Filtered Results List in Overview */}
                  {filteredTransactions.length === 0 ? (
                    <div className="py-5 text-center text-xs text-slate-500 dark:text-slate-400">
                      ရှာဖွေထားသော အချက်အလက်နှင့် ကိုက်ညီသည့် စာရင်း မတွေ့ပါ။
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto pr-1">
                      {filteredTransactions.map((tx) => (
                        <div key={tx.id} className="py-2.5 flex items-center justify-between gap-3">
                          <div
                            onClick={() => openEditTransactionModal(tx)}
                            className="min-w-0 flex-1 cursor-pointer"
                          >
                            <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {tx.title}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              <span>{tx.category}</span>
                              <span className="mx-1.5" aria-hidden="true">·</span>
                              <span className="font-mono-tabular">{tx.date}</span>
                              {tx.note ? ` · ${tx.note}` : ''}
                            </div>
                          </div>

                          <div className="text-right shrink-0 flex items-center gap-2">
                            <div className="mr-1">
                              <div
                                className={`font-mono-tabular text-xs sm:text-sm font-bold whitespace-nowrap ${
                                  tx.type === 'income'
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : tx.type === 'savings'
                                    ? 'text-sky-600 dark:text-sky-400'
                                    : tx.type === 'remittance'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-slate-900 dark:text-slate-100'
                                }`}
                              >
                                {tx.type === 'income' ? '+' : tx.type === 'savings' ? '' : '-'}
                                {formatSgd(tx.amountSgd)}
                              </div>
                              <div className="text-[11px] text-slate-400 whitespace-nowrap">
                                {formatMyanmarLakhs(tx.amountMmk)}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => openEditTransactionModal(tx)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              ပြင်
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Card 1: Smart Hero Balance & Summary Card (Contains Live Exchange Rate + ONLY ONE Add Entry Button) */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
                {/* Card Header Bar: Integrated Live Exchange Rate + Single Primary Action Button */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800/80">
                  <div className="flex items-center gap-2 text-xs sm:text-sm">
                    <span className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">
                      ပေါက်ဈေး
                    </span>
                    <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                    {!isEditingRate ? (
                      <button
                        type="button"
                        onClick={() => setIsEditingRate(true)}
                        className="inline-flex items-center gap-1.5 font-mono-tabular font-bold text-slate-900 dark:text-slate-100 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer"
                      >
                        <span>1 SGD = {metrics.rate.toLocaleString()} ကျပ်</span>
                        <span className="font-sans text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 underline underline-offset-4">
                          ပြင်ရန်
                        </span>
                      </button>
                    ) : (
                      <form onSubmit={handleSaveExchangeRate} className="inline-flex items-center gap-1.5">
                        <input
                          type="number"
                          step="1"
                          min="100"
                          value={rateDraft}
                          onChange={(e) => setRateDraft(e.target.value)}
                          className="w-24 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 font-mono-tabular text-xs font-bold focus:outline-none focus:border-emerald-600"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                        >
                          သိမ်းမည်
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRateDraft(String(metrics.rate));
                            setIsEditingRate(false);
                          }}
                          className="px-2 py-1 rounded-lg text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                        >
                          ပယ်ဖျက်
                        </button>
                      </form>
                    )}
                  </div>

                  {/* The ONLY Add Entry Button in the ပင်မ Tab */}
                  <button
                    type="button"
                    onClick={() => openAddModal('expense')}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>စာရင်းသွင်းမည်</span>
                  </button>
                </div>

                {/* Main Dual-Currency Balance Display */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 items-start sm:items-end">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      လက်ထဲရှိ စင်ကာပူငွေ (SGD လက်ကျန်)
                    </div>
                    <div className="mt-1.5 font-mono-tabular text-2xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100 break-words">
                      {formatSgd(metrics.cashInHandSgd)}
                    </div>
                  </div>

                  <div className="sm:text-right min-w-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800/80">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      လက်ရှိ မြန်မာငွေပေါက်ဈေးအရ တန်ဖိုး
                    </div>
                    <div className="mt-1.5 text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400 break-words">
                      {formatMyanmarLakhs(metrics.cashInHandMmk)}
                    </div>
                    <div className="mt-0.5 font-mono-tabular text-xs text-slate-400">
                      {formatMmk(metrics.cashInHandMmk)}
                    </div>
                  </div>
                </div>

                {/* 5 Clean Key Metrics in a Responsive Non-Overlapping Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 pt-2">
                  <div className="bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/80 rounded-xl p-3 min-w-0">
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                      ဝင်ငွေ
                    </div>
                    <div className="mt-1 font-mono-tabular text-sm sm:text-base font-bold text-emerald-600 dark:text-emerald-400 truncate">
                      +{formatSgd(metrics.totalIncomeSgd)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                      {formatMyanmarLakhs(metrics.totalIncomeMmk)}
                    </div>
                  </div>

                  <div className="bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/80 rounded-xl p-3 min-w-0">
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                      အသုံးစရိတ်
                    </div>
                    <div className="mt-1 font-mono-tabular text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                      -{formatSgd(metrics.totalExpenseSgd)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                      {formatMyanmarLakhs(metrics.totalExpenseMmk)}
                    </div>
                  </div>

                  <div className="bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/80 rounded-xl p-3 min-w-0">
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                      စုငွေ
                    </div>
                    <div className="mt-1 font-mono-tabular text-sm sm:text-base font-bold text-sky-600 dark:text-sky-400 truncate">
                      {formatSgd(metrics.totalSavingsSgd)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                      {formatMyanmarLakhs(metrics.totalSavingsMmk)}
                    </div>
                  </div>

                  <div className="bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/80 rounded-xl p-3 min-w-0">
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                      အိမ်ပို့ငွေ
                    </div>
                    <div className="mt-1 font-mono-tabular text-sm sm:text-base font-bold text-amber-600 dark:text-amber-400 truncate">
                      -{formatSgd(metrics.totalRemittanceSgd)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                      {formatMyanmarLakhs(metrics.totalRemittanceMmk)}
                    </div>
                  </div>

                  <div
                    onClick={() => setActiveSection('portfolio')}
                    className="bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/80 hover:border-emerald-500/60 rounded-xl p-3 min-w-0 col-span-2 sm:col-span-1 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                        စတော့ / BTC
                      </span>
                      <span
                        className={`font-mono-tabular text-[11px] font-semibold shrink-0 ${
                          metrics.portfolioProfitSgd >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {metrics.portfolioProfitPct >= 0 ? '+' : ''}
                        {metrics.portfolioProfitPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1 font-mono-tabular text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                      {formatSgd(metrics.portfolioValueSgd)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                      {formatMyanmarLakhs(metrics.portfolioValueMmk)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Responsive 2-Column Workspace on Web (Chart + Quick SGD⇄MMK Calculator) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                {/* Card 2: Expense Category Distribution Bar Chart (7 cols on Web) */}
                <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        အသုံးစရိတ် ကဏ္ဍအလိုက် ခွဲခြမ်းစိတ်ဖြာမှု
                      </h2>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span>{expenseChartSummary.periodLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                          {formatSgd(expenseChartSummary.periodTotalSgd)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          {formatMyanmarLakhs(expenseChartSummary.periodTotalMmk)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl">
                        {(
                          [
                            { id: 'weekly', label: 'အပတ်စဉ်' },
                            { id: 'monthly', label: 'လစဉ်' },
                            { id: 'yearly', label: 'နှစ်စဉ်' },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setExpensePeriod(tab.id)}
                            className={`min-h-[30px] px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              expensePeriod === tab.id
                                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => setIncludeRemittanceInChart((prev) => !prev)}
                        className={`min-h-[32px] px-2.5 py-1 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          includeRemittanceInChart
                            ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {includeRemittanceInChart ? 'အိမ်ပို့ငွေ ပါဝင်သည်' : 'အိမ်ပို့ငွေ မပါဝင်ပါ'}
                      </button>
                    </div>
                  </div>

                  {expenseChartSummary.data.length === 0 ? (
                    <div className="py-10 text-center space-y-3 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        ရွေးချယ်ထားသော ကာလအတွင်း အသုံးစရိတ်စာရင်း မရှိသေးပါ။
                      </p>
                    </div>
                  ) : (
                    <div className="h-64 w-full pt-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={expenseChartSummary.data}
                          layout="vertical"
                          margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            horizontal={false}
                            stroke={isDark ? '#1e293b' : '#f1f5f9'}
                          />
                          <XAxis
                            type="number"
                            tickFormatter={(val: number) => `S$${val}`}
                            tick={{
                              fill: isDark ? '#94a3b8' : '#64748b',
                              fontSize: 11,
                            }}
                            axisLine={{ stroke: isDark ? '#334155' : '#e2e8f0' }}
                            tickLine={false}
                          />
                          <YAxis
                            type="category"
                            dataKey="shortLabel"
                            tick={{
                              fill: isDark ? '#cbd5e1' : '#334155',
                              fontSize: 11,
                            }}
                            axisLine={false}
                            tickLine={false}
                            width={108}
                          />
                          <Tooltip
                            cursor={{
                              fill: isDark ? 'rgba(30, 41, 59, 0.5)' : 'rgba(241, 245, 249, 0.8)',
                            }}
                            content={({ active, payload }) => {
                              if (!active || !payload || !payload.length) return null;
                              const item = payload[0].payload as {
                                category: string;
                                labelMm: string;
                                amountSgd: number;
                                amountMmk: number;
                                count: number;
                                sharePct: number;
                              };
                              return (
                                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-lg text-xs space-y-1">
                                  <div className="font-bold text-slate-900 dark:text-slate-100">
                                    {item.labelMm}
                                  </div>
                                  <div className="text-slate-500 dark:text-slate-400">
                                    {item.category} · {item.count} ကြိမ် ({item.sharePct}%)
                                  </div>
                                  <div className="pt-1 font-mono-tabular text-sm font-bold text-emerald-600 dark:text-emerald-400">
                                    {formatSgd(item.amountSgd)}
                                  </div>
                                  <div className="text-slate-600 dark:text-slate-300 font-medium">
                                    {formatMyanmarLakhs(item.amountMmk)}
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="amountSgd" radius={[0, 6, 6, 0]} maxBarSize={26}>
                            {expenseChartSummary.data.map((entry, index) => {
                              const barColors = [
                                '#059669',
                                '#0284c7',
                                '#4f46e5',
                                '#0d9488',
                                '#6366f1',
                                '#64748b',
                              ];
                              const fill = entry.isRemittance
                                ? '#d97706'
                                : barColors[index % barColors.length];
                              return <Cell key={entry.category} fill={fill} />;
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Card 3: Smart SGD ⇄ MMK Calculator (5 cols on Web) */}
                <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-4">
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        စင်ကာပူငွေ ⇄ မြန်မာငွေ အမြန်တွက်စက်
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        လက်ရှိပေါက်ဈေး 1 SGD = {metrics.rate.toLocaleString()} ကျပ်ဖြင့် တွက်ချက်ထားသည်
                      </p>
                    </div>

                    <div className="space-y-3.5">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                          စင်ကာပူဒေါ်လာ (SGD)
                        </label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={calcSgd}
                          onChange={(e) => handleCalcSgdChange(e.target.value)}
                          className="w-full min-h-[46px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 font-mono-tabular text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                          မြန်မာငွေ (သိန်းပေါင်း)
                        </label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={calcLakhs}
                          onChange={(e) => handleCalcLakhsChange(e.target.value)}
                          className="w-full min-h-[46px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 font-mono-tabular text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400 focus:outline-none focus:border-emerald-600"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {formatMyanmarLakhs((parseFloat(calcSgd) || 0) * metrics.rate)}
                    </span>
                    <span className="font-mono-tabular">
                      {formatMmk((parseFloat(calcSgd) || 0) * metrics.rate)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 4: Recent Daily Activity Preview (နောက်ဆုံး နေ့စဉ်စာရင်းများ) */}
              {recentOverviewDayGroups.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        နောက်ဆုံး နေ့စဉ်စာရင်းများ (နောက်ဆုံး {recentOverviewDayGroups.length} ရက်)
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        နေ့စဉ် ရက်အလိုက် မှတ်သားထားသော စာရင်းများ အမြန်ကြည့်ရှုရန်
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveSection('cashflow')}
                      className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    >
                      ရက်အားလုံး အသေးစိတ်ကြည့်ရန် →
                    </button>
                  </div>

                  <div className="space-y-3">
                    {recentOverviewDayGroups.map((dayGroup) => (
                      <div
                        key={dayGroup.date}
                        className="border border-slate-200/70 dark:border-slate-800 rounded-xl overflow-hidden"
                      >
                        <div className="bg-slate-50/90 dark:bg-slate-950/70 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 dark:border-slate-800/80">
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                            <Calendar className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span>{dayGroup.weekdayLabel}</span>
                            <span className="text-slate-400 font-normal">
                              ({dayGroup.items.length} ခု)
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs font-mono-tabular">
                            {dayGroup.incomeSgd > 0 && (
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                +{formatSgd(dayGroup.incomeSgd)}
                              </span>
                            )}
                            {dayGroup.outflowSgd > 0 && (
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                -{formatSgd(dayGroup.outflowSgd)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="divide-y divide-slate-100 dark:divide-slate-800/80 px-3.5">
                          {dayGroup.items.slice(0, 4).map((tx) => (
                            <div
                              key={tx.id}
                              onClick={() => openEditTransactionModal(tx)}
                              className="py-2.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                                  {tx.title}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {tx.category}
                                  {tx.note ? ` · ${tx.note}` : ''}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div
                                  className={`font-mono-tabular text-xs sm:text-sm font-bold whitespace-nowrap ${
                                    tx.type === 'income'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : tx.type === 'savings'
                                      ? 'text-sky-600 dark:text-sky-400'
                                      : tx.type === 'remittance'
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-slate-900 dark:text-slate-100'
                                  }`}
                                >
                                  {tx.type === 'income' ? '+' : tx.type === 'savings' ? '' : '-'}
                                  {formatSgd(tx.amountSgd)}
                                </div>
                                <div className="text-[11px] text-slate-400 whitespace-nowrap">
                                  {formatMyanmarLakhs(tx.amountMmk)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =========================================================
              TAB 2: ဝင်ငွေ / အသုံးစရိတ် (Smart Daily Grouped Ledger, Daily Summary & Month/Date Filter)
             ========================================================= */}
          {activeSection === 'cashflow' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5">
              {/* Top Row: Category Filter Tabs + Add Button */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl overflow-x-auto max-w-full">
                  {(
                    [
                      { id: 'all', label: 'အားလုံး' },
                      { id: 'expense', label: 'အသုံးစရိတ်' },
                      { id: 'savings', label: 'စုငွေ' },
                      { id: 'remittance', label: 'အိမ်ပို့ငွေ' },
                      { id: 'income', label: 'ဝင်ငွေ' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setTxFilter(tab.id);
                        setVisibleDayLimit(15);
                        setVisibleTableLimit(30);
                      }}
                      className={`min-h-[34px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        txFilter === tab.id
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => openAddModal(txFilter === 'all' ? 'expense' : txFilter)}
                  className="min-h-[38px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>စာရင်းအသစ်ထည့်မည်</span>
                </button>
              </div>

              {/* Second Row: Month Selector + Specific Date Picker + View Mode Switcher */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Month / Period Filter Dropdown */}
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      ကာလ:
                    </label>
                    <select
                      value={txSpecificDate ? 'custom_date' : txMonthFilter}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val !== 'custom_date') {
                          setTxSpecificDate('');
                          setTxMonthFilter(val);
                          setVisibleDayLimit(15);
                          setVisibleTableLimit(30);
                        }
                      }}
                      className="min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                    >
                      <option value="all">ကာလအားလုံး (All Dates)</option>
                      <option value="7days">နောက်ဆုံး ၇ ရက်</option>
                      {availableMonths.map((ym) => (
                        <option key={ym} value={ym}>
                          {formatMyanmarMonthLabel(ym)}
                        </option>
                      ))}
                      {txSpecificDate && (
                        <option value="custom_date">ရက်စွဲ: {txSpecificDate}</option>
                      )}
                    </select>
                  </div>

                  {/* Direct Date Picker to jump to any single day */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={txSpecificDate}
                      onChange={(e) => {
                        setTxSpecificDate(e.target.value);
                        setVisibleDayLimit(15);
                      }}
                      aria-label="ရက်စွဲအလိုက် ရွေးကြည့်ရန်"
                      className="min-h-[38px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 font-mono-tabular text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-emerald-600"
                    />
                    {(txSpecificDate || txMonthFilter !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setTxSpecificDate('');
                          setTxMonthFilter('all');
                        }}
                        className="min-h-[38px] px-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        ရက်အားလုံးပြန်ပြ
                      </button>
                    )}
                  </div>
                </div>

                {/* 3 View Modes: Daily Grouped | Daily Summary | Flat Table */}
                <div className="flex items-center justify-between sm:justify-end gap-2">
                  <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl overflow-x-auto">
                    {(
                      [
                        { id: 'daily_grouped', label: 'နေ့စဉ် အုပ်စုဖွဲ့' },
                        { id: 'daily_summary', label: 'ရက်အလိုက် အနှစ်ချုပ်' },
                        { id: 'table', label: 'စာရင်းဇယား' },
                      ] as const
                    ).map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setTxViewMode(mode.id)}
                        className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          txViewMode === mode.id
                            ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-xs'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Search Input Field (Filter by Title, Category, Note, or Date) */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={txSearchQuery}
                  onChange={(e) => setTxSearchQuery(e.target.value)}
                  placeholder="ခေါင်းစဉ်၊ အမျိုးအစား၊ ရက်စွဲ သို့မဟုတ် မှတ်ချက် (Note) ဖြင့် အမြန်ရှာဖွေရန်..."
                  className="w-full min-h-[44px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-10 pr-10 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600"
                />
                {txSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setTxSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* လက်ရှိ စာရင်း အနှစ်ချုပ် (Current Filtered Summary with Day Count & Daily Average) */}
              <div className="bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                    <span>လက်ရှိ စာရင်း အနှစ်ချုပ်</span>
                    <span className="text-slate-400 font-normal" aria-hidden="true">·</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                      {txSpecificDate
                        ? formatMyanmarDateWeekday(txSpecificDate)
                        : txMonthFilter === 'all'
                        ? 'ကာလအားလုံး'
                        : txMonthFilter === '7days'
                        ? 'နောက်ဆုံး ၇ ရက်'
                        : formatMyanmarMonthLabel(txMonthFilter)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      စုစုပေါင်း <span className="font-mono-tabular font-bold text-slate-900 dark:text-slate-100">{filteredCashflowSummary.dayCount}</span> ရက်
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      စာရင်း <span className="font-mono-tabular font-bold text-slate-900 dark:text-slate-100">{filteredCashflowSummary.count}</span> ခု
                    </span>
                    {filteredCashflowSummary.dayCount > 0 && filteredCashflowSummary.expenseSgd > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          တစ်ရက်ပျမ်းမျှအသုံး:{' '}
                          <span className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
                            {formatSgd(filteredCashflowSummary.avgDailyExpenseSgd)}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">ဝင်ငွေ စုစုပေါင်း</div>
                    <div className="mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold text-emerald-600 dark:text-emerald-400 truncate">
                      +{formatSgd(filteredCashflowSummary.incomeSgd)}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {formatMyanmarLakhs(filteredCashflowSummary.incomeMmk)}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">အသုံးစရိတ် စုစုပေါင်း</div>
                    <div className="mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                      -{formatSgd(filteredCashflowSummary.expenseSgd)}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {formatMyanmarLakhs(filteredCashflowSummary.expenseMmk)}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">စုငွေ စုစုပေါင်း</div>
                    <div className="mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold text-sky-600 dark:text-sky-400 truncate">
                      {formatSgd(filteredCashflowSummary.savingsSgd)}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {formatMyanmarLakhs(filteredCashflowSummary.savingsMmk)}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">အိမ်ပို့ငွေ စုစုပေါင်း</div>
                    <div className="mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold text-amber-600 dark:text-amber-400 truncate">
                      -{formatSgd(filteredCashflowSummary.remittanceSgd)}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {formatMyanmarLakhs(filteredCashflowSummary.remittanceMmk)}
                    </div>
                  </div>

                  <div className="min-w-0 col-span-2 sm:col-span-1">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">အသားတင် လက်ကျန်</div>
                    <div
                      className={`mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold truncate ${
                        filteredCashflowSummary.netSgd >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {filteredCashflowSummary.netSgd >= 0 ? '+' : ''}
                      {formatSgd(filteredCashflowSummary.netSgd)}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {formatMyanmarLakhs(filteredCashflowSummary.netMmk)}
                    </div>
                  </div>
                </div>
              </div>

              {filteredTransactions.length === 0 ? (
                <div className="py-10 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    ရှာဖွေထားသော အချက်အလက်နှင့် ကိုက်ညီသည့် စာရင်း မတွေ့ပါ။
                  </p>
                  {(txSearchQuery || txSpecificDate || txMonthFilter !== 'all' || txFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setTxSearchQuery('');
                        setTxSpecificDate('');
                        setTxMonthFilter('all');
                        setTxFilter('all');
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      စစ်ထုတ်မှုအားလုံး ပြန်ရှင်းမည်
                    </button>
                  )}
                </div>
              ) : txViewMode === 'daily_grouped' ? (
                /* =========================================================
                   MODE 1: နေ့စဉ် အုပ်စုဖွဲ့ (Collapsible Daily Grouped Ledger)
                   ========================================================= */
                <div className="space-y-3.5">
                  {dailyTransactionGroups.length > 1 && (
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
                      <span>
                        နေ့စဉ် ရက်အလိုက် အုပ်စုဖွဲ့ပြသထားသည် (ရက်စွဲတန်းကိုနှိပ်၍ ချုံ့/ဖြန့်နိုင်သည်)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (collapsedDays.size >= dailyTransactionGroups.length) {
                            setCollapsedDays(new Set());
                          } else {
                            setCollapsedDays(new Set(dailyTransactionGroups.map((g) => g.date)));
                          }
                        }}
                        className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {collapsedDays.size >= dailyTransactionGroups.length
                          ? 'ရက်အားလုံး ဖြန့်မည်'
                          : 'ရက်အားလုံး ချုံ့မည်'}
                      </button>
                    </div>
                  )}

                  {dailyTransactionGroups.slice(0, visibleDayLimit).map((dayGroup) => {
                    const isCollapsed = collapsedDays.has(dayGroup.date);
                    return (
                      <div
                        key={dayGroup.date}
                        className="border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900"
                      >
                        {/* Day Header Bar */}
                        <button
                          type="button"
                          onClick={() => {
                            setCollapsedDays((prev) => {
                              const next = new Set(prev);
                              if (next.has(dayGroup.date)) {
                                next.delete(dayGroup.date);
                              } else {
                                next.add(dayGroup.date);
                              }
                              return next;
                            });
                          }}
                          className="w-full px-3.5 sm:px-4 py-3 bg-slate-50/90 dark:bg-slate-950/80 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-left transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {isCollapsed ? (
                              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            )}
                            <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                              {dayGroup.weekdayLabel}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                              · {dayGroup.items.length} ခု
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5 sm:gap-4 text-xs font-mono-tabular shrink-0">
                            {dayGroup.incomeSgd > 0 && (
                              <span className="font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                ဝင်ငွေ +{formatSgd(dayGroup.incomeSgd)}
                              </span>
                            )}
                            {dayGroup.outflowSgd > 0 && (
                              <span className="font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                ထွက်ငွေ -{formatSgd(dayGroup.outflowSgd)}
                              </span>
                            )}
                            <span className="text-[11px] font-sans font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              ({formatMyanmarLakhs(dayGroup.outflowSgd > 0 ? dayGroup.outflowMmk : dayGroup.incomeMmk)})
                            </span>
                          </div>
                        </button>

                        {/* Day Items List */}
                        {!isCollapsed && (
                          <div className="divide-y divide-slate-100 dark:divide-slate-800/80 px-3.5 sm:px-4">
                            {dayGroup.items.map((tx) => (
                              <div
                                key={tx.id}
                                className="py-3 flex items-center justify-between gap-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                              >
                                <div
                                  onClick={() => openEditTransactionModal(tx)}
                                  className="min-w-0 flex-1 cursor-pointer"
                                >
                                  <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    {tx.title}
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                    <span>{tx.category}</span>
                                    {tx.recipientOrMerchant && tx.recipientOrMerchant !== 'Singapore' ? (
                                      <>
                                        <span className="mx-1.5" aria-hidden="true">·</span>
                                        <span>{tx.recipientOrMerchant}</span>
                                      </>
                                    ) : null}
                                    {tx.note ? (
                                      <>
                                        <span className="mx-1.5" aria-hidden="true">·</span>
                                        <span className="text-slate-400">{tx.note}</span>
                                      </>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="text-right shrink-0 flex items-center gap-1.5 sm:gap-2">
                                  <div className="mr-0.5">
                                    <div
                                      className={`font-mono-tabular text-xs sm:text-sm font-bold whitespace-nowrap ${
                                        tx.type === 'income'
                                          ? 'text-emerald-600 dark:text-emerald-400'
                                          : tx.type === 'savings'
                                          ? 'text-sky-600 dark:text-sky-400'
                                          : tx.type === 'remittance'
                                          ? 'text-amber-600 dark:text-amber-400'
                                          : 'text-slate-900 dark:text-slate-100'
                                      }`}
                                    >
                                      {tx.type === 'income' ? '+' : tx.type === 'savings' ? '' : '-'}
                                      {formatSgd(tx.amountSgd)}
                                    </div>
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                      {formatMyanmarLakhs(tx.amountMmk)}
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => openEditTransactionModal(tx)}
                                    className="h-8 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                    aria-label="Edit"
                                  >
                                    <Edit3 className="w-3 h-3 shrink-0" />
                                    <span className="hidden sm:inline">ပြင်မည်</span>
                                    <span className="sm:hidden">ပြင်</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleDeleteTransaction(tx.id)}
                                    className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 shrink-0 cursor-pointer"
                                    aria-label="Delete"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {dailyTransactionGroups.length > visibleDayLimit && (
                    <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setVisibleDayLimit((prev) => prev + 15)}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        နောက်ထပ် ရက်များ ဆက်ကြည့်မည် (ကျန် {dailyTransactionGroups.length - visibleDayLimit} ရက်)
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisibleDayLimit(dailyTransactionGroups.length)}
                        className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                      >
                        ရက်အားလုံး ပြမည် ({dailyTransactionGroups.length} ရက်)
                      </button>
                    </div>
                  )}
                </div>
              ) : txViewMode === 'daily_summary' ? (
                /* =========================================================
                   MODE 2: ရက်အလိုက် အနှစ်ချုပ် (Compact Daily Summary Table)
                   ========================================================= */
                <div className="space-y-3">
                  <div className="text-xs text-slate-500 dark:text-slate-400 px-1">
                    ရက်တစ်ရက်ချင်းစီ၏ စုစုပေါင်း စာရင်းချုပ်ဖြစ်ပါသည်။ ရက်စွဲကိုနှိပ်ပါက ထိုနေ့၏ စာရင်းအသေးစိတ်ကို တန်းကြည့်နိုင်ပါသည်။
                  </div>
                  <div className="overflow-x-auto border border-slate-200/80 dark:border-slate-800 rounded-xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                          <th className="py-3 px-4 font-semibold whitespace-nowrap">ရက်စွဲနှင့် နေ့ရက်</th>
                          <th className="py-3 px-3 font-semibold text-center whitespace-nowrap">အရေအတွက်</th>
                          <th className="py-3 px-3 font-semibold text-right whitespace-nowrap">နေ့စဉ် ဝင်ငွေ</th>
                          <th className="py-3 px-3 font-semibold text-right whitespace-nowrap">နေ့စဉ် ထွက်ငွေ</th>
                          <th className="py-3 px-4 font-semibold text-right whitespace-nowrap">မြန်မာငွေ တန်ဖိုး</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs sm:text-sm">
                        {dailyTransactionGroups.slice(0, visibleDayLimit).map((dayGroup) => (
                          <tr
                            key={dayGroup.date}
                            onClick={() => {
                              setTxSpecificDate(dayGroup.date);
                              setTxViewMode('daily_grouped');
                              setCollapsedDays(new Set());
                            }}
                            className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                          >
                            <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {dayGroup.weekdayLabel}
                            </td>
                            <td className="py-3.5 px-3 text-center font-mono-tabular text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              {dayGroup.items.length} ခု
                            </td>
                            <td className="py-3.5 px-3 font-mono-tabular font-bold text-right text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                              {dayGroup.incomeSgd > 0 ? `+${formatSgd(dayGroup.incomeSgd)}` : '—'}
                            </td>
                            <td className="py-3.5 px-3 font-mono-tabular font-bold text-right text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {dayGroup.outflowSgd > 0 ? `-${formatSgd(dayGroup.outflowSgd)}` : '—'}
                            </td>
                            <td className="py-3.5 px-4 text-right font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                              {formatMyanmarLakhs(
                                dayGroup.outflowSgd > 0 ? dayGroup.outflowMmk : dayGroup.incomeMmk
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {dailyTransactionGroups.length > visibleDayLimit && (
                    <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setVisibleDayLimit((prev) => prev + 20)}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        နောက်ထပ် ရက်များ ဆက်ကြည့်မည် (ကျန် {dailyTransactionGroups.length - visibleDayLimit} ရက်)
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisibleDayLimit(dailyTransactionGroups.length)}
                        className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer"
                      >
                        ရက်အားလုံး ပြမည်
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* =========================================================
                   MODE 3: စာရင်းဇယား (Classic Paginated Table & Mobile List)
                   ========================================================= */
                <>
                  {/* Mobile View: Clean Rows with Both Edit & Delete Buttons */}
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
                    {filteredTransactions.slice(0, visibleTableLimit).map((tx) => (
                      <div key={tx.id} className="py-3.5 flex items-center justify-between gap-2.5">
                        <div
                          onClick={() => openEditTransactionModal(tx)}
                          className="min-w-0 flex-1 cursor-pointer"
                        >
                          <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {tx.title}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            <span>{tx.category}</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span className="font-mono-tabular">{tx.date}</span>
                          </div>
                          {tx.note && (
                            <div className="text-[11px] text-slate-400 truncate mt-0.5">
                              {tx.note}
                            </div>
                          )}
                        </div>

                        <div className="text-right shrink-0 flex items-center gap-1.5">
                          <div className="mr-0.5">
                            <div
                              className={`font-mono-tabular text-xs sm:text-sm font-bold whitespace-nowrap ${
                                tx.type === 'income'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : tx.type === 'savings'
                                  ? 'text-sky-600 dark:text-sky-400'
                                  : tx.type === 'remittance'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {tx.type === 'income' ? '+' : tx.type === 'savings' ? '' : '-'}
                              {formatSgd(tx.amountSgd)}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {formatMyanmarLakhs(tx.amountMmk)}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => openEditTransactionModal(tx)}
                            className="h-8 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            aria-label="Edit"
                          >
                            <Edit3 className="w-3 h-3 shrink-0" />
                            <span>ပြင်</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteTransaction(tx.id)}
                            className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 shrink-0 cursor-pointer"
                            aria-label="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Tablet & Web View: Clean 5-Column Table with Explicit Edit Button */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                          <th className="py-3 pr-4 font-medium whitespace-nowrap">ရက်စွဲ</th>
                          <th className="py-3 px-4 font-medium">အကြောင်းအရာ</th>
                          <th className="py-3 px-4 font-medium text-right whitespace-nowrap">စင်ကာပူငွေ (SGD)</th>
                          <th className="py-3 px-4 font-medium text-right whitespace-nowrap">မြန်မာငွေ (သိန်း)</th>
                          <th className="py-3 pl-4 font-medium text-right whitespace-nowrap">ပြင်ဆင် / ဖျက်ရန်</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                        {filteredTransactions.slice(0, visibleTableLimit).map((tx) => (
                          <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-3.5 pr-4 font-mono-tabular text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {tx.date}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                {tx.title}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {tx.category}
                                {tx.note ? ` · ${tx.note}` : ''}
                              </div>
                            </td>
                            <td
                              className={`py-3.5 px-4 font-mono-tabular font-bold text-right whitespace-nowrap ${
                                tx.type === 'income'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : tx.type === 'savings'
                                  ? 'text-sky-600 dark:text-sky-400'
                                  : tx.type === 'remittance'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {tx.type === 'income' ? '+' : tx.type === 'savings' ? '' : '-'}
                              {formatSgd(tx.amountSgd)}
                            </td>
                            <td className="py-3.5 px-4 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                              {formatMyanmarLakhs(tx.amountMmk)}
                            </td>
                            <td className="py-3.5 pl-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEditTransactionModal(tx)}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>ပြင်မည်</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTransaction(tx.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 cursor-pointer"
                                  aria-label="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {filteredTransactions.length > visibleTableLimit && (
                    <div className="pt-3 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setVisibleTableLimit((prev) => prev + 30)}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        နောက်ထပ် စာရင်းများ ဆက်ကြည့်မည် (ကျန် {filteredTransactions.length - visibleTableLimit} ခု)
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisibleTableLimit(filteredTransactions.length)}
                        className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer"
                      >
                        စာရင်းအားလုံး ပြမည် ({filteredTransactions.length} ခု)
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* =========================================================
              TAB 3: စတော့ / Bitcoin (Smart Responsive Layout for Mobile, Tablet & Web)
             ========================================================= */}
          {activeSection === 'portfolio' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5">
              {/* Header Bar: Title + Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                    စတော့၊ ETF နှင့် Bitcoin ရင်းနှီးမြှုပ်နှံမှုစာရင်း
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    ပေါက်ဈေး 1 SGD = {metrics.rate.toLocaleString()} ကျပ်ဖြင့် တွက်ချက်ထားပါသည်
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleRefreshLiveBtc}
                    disabled={isRefreshingMarket}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isRefreshingMarket ? 'animate-spin' : ''}`} />
                    <span>BTC ပေါက်ဈေးရယူမည်</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingHolding(null);
                      setEditingTx(null);
                      setModalMode('holding');
                      setModalOpen(true);
                    }}
                    className="min-h-[38px] px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>အသစ်ထည့်မည်</span>
                  </button>
                </div>
              </div>

              {/* 3-Card Portfolio Summary Strip (Market Value, Total Cost, Total Profit/Loss) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 rounded-xl p-3.5 min-w-0">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    စုစုပေါင်း လက်ရှိတန်ဖိုး
                  </div>
                  <div className="mt-1 font-mono-tabular text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
                    {formatSgd(metrics.portfolioValueSgd)}
                  </div>
                  <div className="mt-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 truncate">
                    {formatMyanmarLakhs(metrics.portfolioValueMmk)}
                  </div>
                </div>

                <div className="bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 rounded-xl p-3.5 min-w-0">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    စုစုပေါင်း ရင်းနှီးမြှုပ်နှံငွေ (ဝယ်ရင်း)
                  </div>
                  <div className="mt-1 font-mono-tabular text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
                    {formatSgd(metrics.portfolioCostSgd)}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                    {formatMyanmarLakhs(metrics.portfolioCostMmk)}
                  </div>
                </div>

                <div className="bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 rounded-xl p-3.5 min-w-0">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    စုစုပေါင်း အမြတ် / အရှုံး
                  </div>
                  <div
                    className={`mt-1 font-mono-tabular text-lg sm:text-xl font-bold truncate ${
                      metrics.portfolioProfitSgd >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {metrics.portfolioProfitSgd >= 0 ? '+' : ''}
                    {formatSgd(metrics.portfolioProfitSgd)}{' '}
                    <span className="text-xs font-semibold">
                      ({metrics.portfolioProfitPct >= 0 ? '+' : ''}
                      {metrics.portfolioProfitPct.toFixed(2)}%)
                    </span>
                  </div>
                  <div
                    className={`mt-0.5 text-xs font-medium truncate ${
                      metrics.portfolioProfitSgd >= 0
                        ? 'text-emerald-600/90 dark:text-emerald-400/90'
                        : 'text-red-600/90 dark:text-red-400/90'
                    }`}
                  >
                    {metrics.portfolioProfitSgd >= 0 ? '+' : '-'}
                    {formatMyanmarLakhs(Math.abs(metrics.portfolioProfitMmk))}
                  </div>
                </div>
              </div>

              {/* Filter Tabs by Asset Type */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl overflow-x-auto max-w-full">
                  {(
                    [
                      { id: 'all', label: 'အားလုံး' },
                      { id: 'stock', label: 'စတော့ (Stock)' },
                      { id: 'etf', label: 'ETF' },
                      { id: 'crypto', label: 'Bitcoin / Crypto' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setHoldingFilter(tab.id)}
                      className={`min-h-[34px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        holdingFilter === tab.id
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400">
                  စုစုပေါင်း <span className="font-mono-tabular font-bold text-slate-900 dark:text-slate-100">{filteredHoldings.length}</span> ခု
                </div>
              </div>

              {filteredHoldings.length === 0 ? (
                <div className="py-10 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    ရွေးချယ်ထားသော အမျိုးအစားတွင် စာရင်း မရှိသေးပါ။
                  </p>
                </div>
              ) : (
                <>
                  {/* Mobile & Tablet View (< 1024px): Spacious 2-Row Card Layout with Zero Text Overlap */}
                  <div className="divide-y divide-slate-200/70 dark:divide-slate-800 lg:hidden">
                    {filteredHoldings.map((h) => {
                      const valSgd = h.quantity * h.currentPriceSgd;
                      const costSgd = h.quantity * h.avgBuyPriceSgd;
                      const pnlSgd = valSgd - costSgd;
                      const pnlPct = costSgd > 0 ? (pnlSgd / costSgd) * 100 : 0;
                      const valMmk = Math.round(valSgd * metrics.rate);
                      const pnlMmk = Math.round(pnlSgd * metrics.rate);
                      const assetLabel =
                        h.assetType === 'crypto'
                          ? 'Crypto'
                          : h.assetType === 'etf'
                          ? 'ETF'
                          : 'Stock';

                      return (
                        <div key={h.id} className="py-4 first:pt-1 last:pb-1 space-y-3">
                          {/* Top Row: Asset Identity on Left + Edit/Delete Actions on Right */}
                          <div className="flex items-start justify-between gap-3">
                            <div
                              onClick={() => openEditHoldingModal(h)}
                              className="min-w-0 flex-1 cursor-pointer"
                            >
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="font-mono-tabular text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                                  {h.symbol}
                                </span>
                                <span className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">
                                  {h.name}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                <span>{assetLabel}</span>
                                {h.platform ? (
                                  <>
                                    <span className="mx-1.5" aria-hidden="true">·</span>
                                    <span>{h.platform}</span>
                                  </>
                                ) : null}
                                {h.note ? (
                                  <>
                                    <span className="mx-1.5" aria-hidden="true">·</span>
                                    <span>{h.note}</span>
                                  </>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => openEditHoldingModal(h)}
                                className="h-8 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                aria-label="Edit"
                              >
                                <Edit3 className="w-3.5 h-3.5 shrink-0" />
                                <span>ပြင်မည်</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteHolding(h.id)}
                                className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 shrink-0 cursor-pointer"
                                aria-label="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Bottom Row: 2x2 (Mobile) / 4-Col (Tablet) Structured Metric Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/80 rounded-xl p-3">
                            <div className="min-w-0">
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                အရေအတွက် / ဝယ်ဈေး
                              </div>
                              <div className="mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                                {h.quantity} units
                              </div>
                              <div className="text-[11px] font-mono-tabular text-slate-400 truncate">
                                @ {formatSgd(h.avgBuyPriceSgd)}
                              </div>
                            </div>

                            <div className="min-w-0">
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                လက်ရှိပေါက်ဈေး
                              </div>
                              <div className="mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                                {formatSgd(h.currentPriceSgd)}
                              </div>
                              <div className="text-[11px] text-slate-400 truncate">
                                {formatMyanmarLakhs(Math.round(h.currentPriceSgd * metrics.rate))}
                              </div>
                            </div>

                            <div className="min-w-0">
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                စုစုပေါင်းတန်ဖိုး
                              </div>
                              <div className="mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                                {formatSgd(valSgd)}
                              </div>
                              <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 truncate">
                                {formatMyanmarLakhs(valMmk)}
                              </div>
                            </div>

                            <div className="min-w-0">
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                အမြတ် / အရှုံး
                              </div>
                              <div
                                className={`mt-0.5 font-mono-tabular text-xs sm:text-sm font-bold truncate ${
                                  pnlSgd >= 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-red-600 dark:text-red-400'
                                }`}
                              >
                                {pnlSgd >= 0 ? '+' : ''}
                                {formatSgd(pnlSgd)} ({pnlPct >= 0 ? '+' : ''}
                                {pnlPct.toFixed(1)}%)
                              </div>
                              <div
                                className={`text-[11px] truncate ${
                                  pnlSgd >= 0
                                    ? 'text-emerald-600/80 dark:text-emerald-400/80'
                                    : 'text-red-600/80 dark:text-red-400/80'
                                }`}
                              >
                                {pnlSgd >= 0 ? '+' : '-'}
                                {formatMyanmarLakhs(Math.abs(pnlMmk))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Web View (>= 1024px): Clean 7-Column Table */}
                  <div className="hidden lg:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                          <th className="py-3 pr-4 font-medium whitespace-nowrap">အမည် / ပလက်ဖောင်း</th>
                          <th className="py-3 px-3 font-medium text-right whitespace-nowrap">အရေအတွက်</th>
                          <th className="py-3 px-3 font-medium text-right whitespace-nowrap">ပျမ်းမျှဝယ်ဈေး</th>
                          <th className="py-3 px-3 font-medium text-right whitespace-nowrap">လက်ရှိဈေး (SGD)</th>
                          <th className="py-3 px-3 font-medium text-right whitespace-nowrap">စုစုပေါင်းတန်ဖိုး</th>
                          <th className="py-3 px-3 font-medium text-right whitespace-nowrap">အမြတ် / အရှုံး</th>
                          <th className="py-3 pl-4 font-medium text-right whitespace-nowrap">ပြင်ဆင် / ဖျက်ရန်</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                        {filteredHoldings.map((h) => {
                          const costSgd = h.quantity * h.avgBuyPriceSgd;
                          const valSgd = h.quantity * h.currentPriceSgd;
                          const pnlSgd = valSgd - costSgd;
                          const pnlPct = costSgd > 0 ? (pnlSgd / costSgd) * 100 : 0;
                          const valMmk = Math.round(valSgd * metrics.rate);
                          const pnlMmk = Math.round(pnlSgd * metrics.rate);
                          const assetLabel =
                            h.assetType === 'crypto'
                              ? 'Crypto'
                              : h.assetType === 'etf'
                              ? 'ETF'
                              : 'Stock';

                          return (
                            <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="py-3.5 pr-4">
                                <div className="flex items-baseline gap-2">
                                  <span className="font-mono-tabular font-bold text-slate-900 dark:text-slate-100">
                                    {h.symbol}
                                  </span>
                                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                    {h.name}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                  <span>{assetLabel}</span>
                                  {h.platform ? ` · ${h.platform}` : ''}
                                  {h.note ? ` · ${h.note}` : ''}
                                </div>
                              </td>
                              <td className="py-3.5 px-3 font-mono-tabular text-right whitespace-nowrap">
                                {h.quantity}
                              </td>
                              <td className="py-3.5 px-3 font-mono-tabular text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {formatSgd(h.avgBuyPriceSgd)}
                              </td>
                              <td className="py-3.5 px-3 font-mono-tabular text-right font-medium whitespace-nowrap">
                                {formatSgd(h.currentPriceSgd)}
                              </td>
                              <td className="py-3.5 px-3 text-right whitespace-nowrap">
                                <div className="font-mono-tabular font-bold text-slate-900 dark:text-slate-100">
                                  {formatSgd(valSgd)}
                                </div>
                                <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                  {formatMyanmarLakhs(valMmk)}
                                </div>
                              </td>
                              <td className="py-3.5 px-3 text-right whitespace-nowrap">
                                <div
                                  className={`font-mono-tabular font-bold ${
                                    pnlSgd >= 0
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-red-600 dark:text-red-400'
                                  }`}
                                >
                                  {pnlSgd >= 0 ? '+' : ''}
                                  {formatSgd(pnlSgd)} ({pnlPct >= 0 ? '+' : ''}
                                  {pnlPct.toFixed(1)}%)
                                </div>
                                <div className="text-xs text-slate-400">
                                  {pnlSgd >= 0 ? '+' : '-'}
                                  {formatMyanmarLakhs(Math.abs(pnlMmk))}
                                </div>
                              </td>
                              <td className="py-3.5 pl-4 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => openEditHoldingModal(h)}
                                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                    <span>ပြင်မည်</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteHolding(h.id)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 cursor-pointer"
                                    aria-label="Delete"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* =========================================================
              TAB 4: ဆက်တင် (Manual Backup & Restore + Biometric Lock + Cloud Sync)
             ========================================================= */}
          {activeSection === 'settings' && (
            <div className="space-y-6">
              {/* Card 0: Install App on Phone with Custom Icon */}
              <div className="bg-white dark:bg-slate-900 border border-emerald-200/90 dark:border-emerald-800/80 rounded-2xl p-5 sm:p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span className="w-14 h-14 aspect-square rounded-2xl overflow-hidden bg-[#073b4c] p-1 shrink-0 inline-flex items-center justify-center shadow-sm">
                      <img
                        src="./assets/aistudio/my_walet_40feb1c8.png"
                        onError={(e) => {
                          const img = e.currentTarget;
                          if (!img.dataset.fallback) {
                            img.dataset.fallback = '1';
                            img.src =
                              './public/assets/aistudio/my_walet_40feb1c8.png';
                          }
                        }}
                        alt="ဥစ္စာပွား App Icon"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain object-center"
                      />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                        ဖုန်းတွင် Application Icon ဖြင့် သွင်းရန် (Install App)
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {isStandaloneApp
                          ? 'သင့်ဖုန်းတွင် ဥစ္စာပွား Application သွင်းထားပြီး ဖြစ်ပါသည်'
                          : 'GitHub Link မှတစ်ဆင့် သင့်ဖုန်း Home Screen ပေါ်တွင် ဥစ္စာပွား Logo ဖြင့် App တစ်ခုကဲ့သို့ တိုက်ရိုက်ဖွင့်သုံးနိုင်ပါသည်'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleInstallAppClick}
                      className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
                    >
                      <Smartphone className="w-4 h-4 shrink-0" />
                      <span>
                        {pwaInstallPrompt
                          ? 'ယခု ဖုန်းထဲသို့ Install သွင်းမည်'
                          : 'ဖုန်းတွင် Install သွင်းနည်း ကြည့်ရန်'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 1: Manual Backup & Restore */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Manual Backup & Restore (ဖိုင်ဖြင့် သိမ်းဆည်းခြင်း နှင့် ပြန်တင်ခြင်း)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    သင့်စာရင်းအားလုံးကို ဖုန်း/ကွန်ပျူတာထဲသို့ Backup ဖိုင်အဖြစ် ဒေါင်းလုဒ်ဆွဲသိမ်းထားနိုင်ပြီး အချိန်မရွေး ပြန်တင်နိုင်ပါသည်
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                  {/* Download JSON Backup */}
                  <button
                    type="button"
                    onClick={handleExportJsonBackup}
                    className="min-h-[46px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>Backup (.json) သိမ်းမည်</span>
                  </button>

                  {/* Restore JSON Backup */}
                  <label className="min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer">
                    <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>
                      {isRestoringBackup ? 'ပြန်တင်နေသည်...' : 'Restore (ဖိုင်ပြန်တင်မည်)'}
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      onChange={handleRestoreFromFile}
                      className="hidden"
                    />
                  </label>

                  {/* Export Excel CSV */}
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="min-h-[46px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Excel (.csv) ထုတ်မည်</span>
                  </button>
                </div>
              </div>

              {/* Card 2: Biometric, PIN & Cloud Sync */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6">
                {/* Row 1: Biometric Lock */}
                <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <div className="text-sm font-bold">Biometric သော့ခတ်စနစ် (TouchID / FaceID)</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {hardwareBioSupported
                        ? 'သင့်စက်၏ Biometric ဖြင့် သော့ခတ်နိုင်ပါသည်'
                        : 'Biometric သို့မဟုတ် PIN ဖြင့် သော့ခတ်နိုင်ပါသည်'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRegisterPasskey}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Fingerprint className="w-4 h-4" />
                      <span>Biometric ချိတ်မည်</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsVaultLocked(true)}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                    >
                      ယခု သော့ခတ်မည်
                    </button>
                  </div>
                </div>

                {/* Row 2: PIN Setting */}
                <form
                  onSubmit={handleSaveSecuritySettings}
                  className="space-y-3 pb-5 border-b border-slate-100 dark:border-slate-800"
                >
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                          လက်ရှိ PIN နံပါတ်
                        </label>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="••••"
                          value={currentPinDraft}
                          onChange={(e) => {
                            setSecurityFormError(null);
                            setCurrentPinDraft(e.target.value.replace(/[^0-9]/g, ''));
                          }}
                          className="w-32 min-h-[40px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 font-mono-tabular text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                          PIN အသစ် (၄-၆ လုံး)
                        </label>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="PIN အသစ်"
                          value={pinDraft}
                          onChange={(e) => {
                            setSecurityFormError(null);
                            setPinDraft(e.target.value.replace(/[^0-9]/g, ''));
                          }}
                          className="w-32 min-h-[40px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 font-mono-tabular text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                          Auto-Lock အချိန်
                        </label>
                        <select
                          value={autoLockDraft}
                          onChange={(e) => setAutoLockDraft(e.target.value)}
                          className="min-h-[40px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 text-sm"
                        >
                          <option value="1">1 မိနစ်</option>
                          <option value="5">5 မိနစ်</option>
                          <option value="15">15 မိနစ်</option>
                          <option value="30">30 မိနစ်</option>
                        </select>
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                    >
                      သိမ်းမည်
                    </button>
                  </div>
                  {securityFormError && (
                    <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                      {securityFormError}
                    </div>
                  )}
                </form>

                {/* Row 3: Google Cloud Backup */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-bold">Google Cloud Auto-Sync</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {currentUser
                        ? `ချိတ်ဆက်ထားသည်: ${currentUser.email}`
                        : 'Google အကောင့်ဖြင့် စာရင်းများကို Cloud ပေါ်သို့ အလိုအလျောက် သိမ်းဆည်းပါ'}
                    </div>
                  </div>
                  {currentUser ? (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await signOut(auth);
                          showToast('အကောင့်မှ ထွက်ပြီးပါပြီ');
                        } catch {
                          setErrorBanner('အကောင့်မှ ထွက်ရာတွင် အမှားရှိနေပါသည်။');
                        }
                      }}
                      className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>အကောင့်မှထွက်မည်</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await signInWithPopup(auth, googleProvider);
                          showToast('Google Cloud နှင့် ချိတ်ဆက်ပြီးပါပြီ');
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : '';
                          if (msg.includes('unauthorized-domain')) {
                            setErrorBanner(
                              'GitHub domain ဖြင့် Google Sign-In သုံးရန် Firebase Console -> Authentication -> Settings -> Authorized domains တွင် သင့် github.io domain ကို ထည့်ပေးပါ (သို့မဟုတ် Manual Backup .json ဖြင့် သုံးနိုင်ပါသည်)။'
                            );
                          }
                        }
                      }}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <LogIn className="w-4 h-4" />
                      <span>Google ဖြင့်ချိတ်မည်</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Mobile Fixed Bottom Navigation Bar */}
        <nav
          aria-label="Mobile Navigation"
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 items-center h-16 px-2"
        >
          {(
            [
              { id: 'overview', label: 'ပင်မ', Icon: Home },
              { id: 'cashflow', label: 'ဝင်/ထွက်ငွေ', Icon: Receipt },
              { id: 'portfolio', label: 'စတော့/BTC', Icon: TrendingUp },
              { id: 'settings', label: 'ဆက်တင်', Icon: Settings },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = activeSection === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                className={`min-h-[48px] flex flex-col items-center justify-center transition-colors cursor-pointer ${
                  active
                    ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] mt-1 whitespace-nowrap">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Entry Form Modal */}
        <EntryFormModal
          isOpen={modalOpen}
          mode={modalMode}
          defaultTxType={defaultModalTxType}
          currentRate={metrics.rate}
          editingTransaction={editingTx}
          editingHolding={editingHolding}
          onClose={() => {
            setModalOpen(false);
            setEditingTx(null);
            setEditingHolding(null);
          }}
          onSaveTransaction={handleSaveTransaction}
          onSaveHolding={handleSaveHolding}
        />

        {/* Phone Home Screen Install Guide Modal */}
        {showInstallGuideModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-12 h-12 aspect-square rounded-2xl overflow-hidden bg-[#073b4c] p-0.5 shrink-0 inline-flex items-center justify-center shadow-xs">
                    <img
                      src="./assets/aistudio/my_walet_40feb1c8.png"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (!img.dataset.fallback) {
                          img.dataset.fallback = '1';
                          img.src =
                            './public/assets/aistudio/my_walet_40feb1c8.png';
                        }
                      }}
                      alt="ဥစ္စာပွား"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain object-center"
                    />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                      ဥစ္စာပွား App ကို ဖုန်းတွင် သွင်းနည်း
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Application Icon Logo ဖြင့် Home Screen တွင် ထားရှိအသုံးပြုနိုင်ပါသည်
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInstallGuideModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer shrink-0"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {pwaInstallPrompt && (
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/80 space-y-2.5">
                  <div className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                    တိုက်ရိုက် Install သွင်းရန် အသင့်ရှိပါသည်
                  </div>
                  <button
                    type="button"
                    onClick={handleInstallAppClick}
                    className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Smartphone className="w-4 h-4 shrink-0" />
                    <span>ယခု Install သွင်းမည် (Install App)</span>
                  </button>
                </div>
              )}

              {/* Android Instructions */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 space-y-2.5">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-400">
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <span>Android ဖုန်း (Chrome Browser) တွင် သွင်းနည်း</span>
                </div>
                <ol className="text-xs text-slate-700 dark:text-slate-300 space-y-1.5 list-decimal list-inside leading-relaxed">
                  <li>
                    GitHub Link ကို <strong>Google Chrome</strong> ဖြင့် ဖွင့်ပါ။
                  </li>
                  <li>
                    ညာဘက်အပေါ်ထောင့်ရှိ အစက် (၃) စက် <strong>(⋮ Menu)</strong> ကို နှိပ်ပါ။
                  </li>
                  <li>
                    <strong>&ldquo;Add to Home screen&rdquo;</strong> သို့မဟုတ်{' '}
                    <strong>&ldquo;Install app&rdquo;</strong> ကို နှိပ်ပြီး <strong>Install</strong>{' '}
                    လုပ်ပါ။
                  </li>
                </ol>
              </div>

              {/* iPhone / iPad Instructions */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 space-y-2.5">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-sky-700 dark:text-sky-400">
                  <Share2 className="w-4 h-4 shrink-0" />
                  <span>iPhone / iPad (Safari Browser) တွင် သွင်းနည်း</span>
                </div>
                <ol className="text-xs text-slate-700 dark:text-slate-300 space-y-1.5 list-decimal list-inside leading-relaxed">
                  <li>
                    GitHub Link ကို <strong>Safari</strong> Browser ဖြင့် ဖွင့်ပါ။
                  </li>
                  <li>
                    အောက်ခြေအလယ်ရှိ <strong>Share ခလုတ်</strong> (လေးထောင့်ကွက်နှင့် အပေါ်မြားပုံ) ကို
                    နှိပ်ပါ။
                  </li>
                  <li>
                    အောက်သို့ဆွဲပြီး <strong>&ldquo;Add to Home Screen&rdquo;</strong> ကို နှိပ်ပါ။
                  </li>
                  <li>
                    ညာဘက်အပေါ်ထောင့်ရှိ <strong>&ldquo;Add&rdquo;</strong> ကို နှိပ်လိုက်ပါက ဖုန်း
                    Home Screen ပေါ်တွင် <strong>ဥစ္စာပွား Logo</strong> ဖြင့် ရောက်ရှိသွားပါမည်။
                  </li>
                </ol>
              </div>

              <button
                type="button"
                onClick={() => setShowInstallGuideModal(false)}
                className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
              >
                နားလည်ပါပြီ (ပိတ်မည်)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
