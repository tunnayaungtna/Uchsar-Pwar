import React, { useState, useEffect, useCallback } from 'react';
import { Fingerprint, Lock, ShieldCheck, AlertCircle, Delete, Sun, Moon, Clock } from 'lucide-react';
import { verifyBiometricPasskey } from '../utils/webauthn';

interface BiometricLockScreenProps {
  passkeyId: string;
  pinCode: string;
  biometricEnabled: boolean;
  userEmail?: string | null;
  isDark: boolean;
  onToggleTheme: () => void;
  onUnlock: () => void;
}

interface PinSecurityState {
  failedAttempts: number;
  lockoutUntil: number;
}

const PIN_SECURITY_STORAGE_KEY = 'uchsar_pin_security_state_v1';
const MAX_FREE_ATTEMPTS = 3;

function loadPinSecurityState(): PinSecurityState {
  try {
    const raw = localStorage.getItem(PIN_SECURITY_STORAGE_KEY);
    if (!raw) return { failedAttempts: 0, lockoutUntil: 0 };
    const parsed = JSON.parse(raw);
    return {
      failedAttempts: typeof parsed.failedAttempts === 'number' ? parsed.failedAttempts : 0,
      lockoutUntil: typeof parsed.lockoutUntil === 'number' ? parsed.lockoutUntil : 0,
    };
  } catch {
    return { failedAttempts: 0, lockoutUntil: 0 };
  }
}

function savePinSecurityState(state: PinSecurityState) {
  try {
    localStorage.setItem(PIN_SECURITY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function getLockoutDurationSeconds(failedAttempts: number): number {
  if (failedAttempts < MAX_FREE_ATTEMPTS) return 0;
  if (failedAttempts === 3) return 30; // 30 seconds
  if (failedAttempts === 4) return 60; // 1 minute
  if (failedAttempts === 5) return 300; // 5 minutes
  return 900; // 15 minutes for 6+ failed attempts
}

function formatCountdown(seconds: number): string {
  if (seconds >= 60) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')} မိနစ်`;
  }
  return `${seconds} စက္ကန့်`;
}

export const BiometricLockScreen: React.FC<BiometricLockScreenProps> = ({
  passkeyId,
  pinCode,
  biometricEnabled,
  userEmail,
  isDark,
  onToggleTheme,
  onUnlock,
}) => {
  const [enteredPin, setEnteredPin] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [securityState, setSecurityState] = useState<PinSecurityState>(() => loadPinSecurityState());
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    const initial = loadPinSecurityState();
    return Math.max(0, Math.ceil((initial.lockoutUntil - Date.now()) / 1000));
  });

  const targetPin = pinCode || '2026';
  const expectedPinLength = Math.max(4, Math.min(6, targetPin.length));
  const isLockedOut = remainingSeconds > 0;

  useEffect(() => {
    const updateTimer = () => {
      const diff = Math.max(0, Math.ceil((securityState.lockoutUntil - Date.now()) / 1000));
      setRemainingSeconds(diff);
      if (diff === 0 && securityState.lockoutUntil > 0) {
        const clearedState: PinSecurityState = {
          ...securityState,
          lockoutUntil: 0,
        };
        setSecurityState(clearedState);
        savePinSecurityState(clearedState);
        setErrorMessage(null);
      }
    };

    updateTimer();
    if (securityState.lockoutUntil <= Date.now()) return;

    const interval = window.setInterval(updateTimer, 500);
    return () => window.clearInterval(interval);
  }, [securityState]);

  const resetSecurityAndUnlock = useCallback(() => {
    const cleanState: PinSecurityState = { failedAttempts: 0, lockoutUntil: 0 };
    setSecurityState(cleanState);
    savePinSecurityState(cleanState);
    setRemainingSeconds(0);
    setErrorMessage(null);
    onUnlock();
  }, [onUnlock]);

  const handleBiometricVerify = async () => {
    setErrorMessage(null);
    setIsScanning(true);
    setStatusMessage('Biometric စစ်ဆေးနေပါသည်...');

    const result = await verifyBiometricPasskey(passkeyId || 'sim_bio_default');
    setIsScanning(false);

    if (result.verified) {
      setStatusMessage('အတည်ပြုပြီးပါပြီ။ ဖွင့်နေပါသည်...');
      setTimeout(() => {
        resetSecurityAndUnlock();
      }, 120);
    } else {
      setStatusMessage(null);
      setErrorMessage('Biometric မအောင်မြင်ပါ။ PIN နံပါတ်ဖြင့် ဖွင့်ပေးပါ။');
    }
  };

  const handleKeypadDigit = useCallback(
    (digit: string) => {
      if (isLockedOut) return;
      setErrorMessage(null);

      if (enteredPin.length < expectedPinLength) {
        const next = enteredPin + digit;
        setEnteredPin(next);

        if (next.length === expectedPinLength) {
          if (next === targetPin) {
            setStatusMessage('PIN မှန်ကန်ပါသည်။ ဖွင့်နေပါသည်...');
            setTimeout(() => {
              resetSecurityAndUnlock();
            }, 100);
          } else {
            const nextAttempts = securityState.failedAttempts + 1;
            const lockoutSecs = getLockoutDurationSeconds(nextAttempts);
            const lockoutUntil = lockoutSecs > 0 ? Date.now() + lockoutSecs * 1000 : 0;

            const updatedState: PinSecurityState = {
              failedAttempts: nextAttempts,
              lockoutUntil,
            };
            setSecurityState(updatedState);
            savePinSecurityState(updatedState);

            if (lockoutSecs > 0) {
              setRemainingSeconds(lockoutSecs);
              setErrorMessage(
                `PIN နံပါတ် (${nextAttempts}) ကြိမ် မှားယွင်းသောကြောင့် လုံခြုံရေးအရ ခေတ္တပိတ်ထားပါသည်။`
              );
            } else {
              const attemptsLeft = MAX_FREE_ATTEMPTS - nextAttempts;
              setErrorMessage(
                `PIN နံပါတ် မှားယွင်းနေပါသည်။ (နောက်ထပ် ${attemptsLeft} ကြိမ် မှားပါက ခေတ္တပိတ်ပါမည်)`
              );
            }

            setTimeout(() => setEnteredPin(''), 320);
          }
        }
      }
    },
    [enteredPin, expectedPinLength, isLockedOut, resetSecurityAndUnlock, securityState.failedAttempts, targetPin]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLockedOut) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleKeypadDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setEnteredPin((prev) => prev.slice(0, -1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEnteredPin('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeypadDigit, isLockedOut]);

  return (
    <div className={isDark ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between p-4 sm:p-6 select-none transition-colors">
        <div className="max-w-md w-full mx-auto flex justify-end">
          <button
            type="button"
            onClick={onToggleTheme}
            className="min-h-[40px] px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
            <span>{isDark ? 'Day Mode' : 'Night Mode'}</span>
          </button>
        </div>

        <div className="max-w-md w-full mx-auto my-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xs">
            <div className="text-center mb-6">
              <div className="w-16 h-16 aspect-square rounded-2xl overflow-hidden bg-[#073b4c] p-0.5 shadow-sm mx-auto mb-3 flex items-center justify-center">
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
              </div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                ဥစ္စာပွား (Uchsar Pwar)
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {userEmail
                  ? userEmail
                  : 'လုံခြုံရေး သော့ခတ်ထားပါသည် · PIN သို့မဟုတ် Biometric ဖြင့်ဖွင့်ပါ'}
              </p>
            </div>

            {biometricEnabled && (
              <button
                type="button"
                onClick={handleBiometricVerify}
                disabled={isScanning}
                className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm flex items-center justify-center gap-2.5 transition-colors cursor-pointer disabled:opacity-60 mb-5"
              >
                <Fingerprint className={`w-5 h-5 ${isScanning ? 'animate-pulse' : ''}`} />
                <span className="whitespace-nowrap">
                  {isScanning ? 'စစ်ဆေးနေသည်...' : 'Biometric (TouchID / FaceID) ဖြင့်ဖွင့်မည်'}
                </span>
              </button>
            )}

            {statusMessage && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{statusMessage}</span>
              </div>
            )}

            {isLockedOut ? (
              <div className="mb-4 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/80 text-amber-800 dark:text-amber-200 text-xs flex flex-col items-center justify-center gap-1.5 text-center">
                <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-100">
                  <Clock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 animate-pulse" />
                  <span>ခေတ္တ စောင့်ဆိုင်းပေးပါ ({formatCountdown(remainingSeconds)})</span>
                </div>
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  PIN အကြိမ်ကြိမ် မှားယွင်းထားသဖြင့် အချိန်ပြည့်မှ ပြန်လည်ရိုက်ထည့်နိုင်ပါမည်။
                </span>
              </div>
            ) : (
              errorMessage && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center justify-center gap-2 text-center">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )
            )}

            <div className="text-center mb-4">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 flex items-center justify-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>လုံခြုံရေး PIN နံပါတ် ရိုက်ထည့်ပါ</span>
              </div>
              <div className="flex items-center justify-center gap-3 h-8">
                {Array.from({ length: expectedPinLength }).map((_, idx) => {
                  const filled = idx < enteredPin.length;
                  return (
                    <div
                      key={idx}
                      className={`w-3.5 h-3.5 rounded-full transition-all ${
                        filled
                          ? 'bg-emerald-600 dark:bg-emerald-400 scale-110'
                          : 'bg-slate-200 dark:bg-slate-800'
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  disabled={isLockedOut}
                  onClick={() => handleKeypadDigit(digit)}
                  className="min-h-[52px] rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 font-mono-tabular text-lg font-semibold text-slate-800 dark:text-slate-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                disabled={isLockedOut || enteredPin.length === 0}
                onClick={() => setEnteredPin('')}
                className="min-h-[52px] rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={isLockedOut}
                onClick={() => handleKeypadDigit('0')}
                className="min-h-[52px] rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 font-mono-tabular text-lg font-semibold text-slate-800 dark:text-slate-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                0
              </button>
              <button
                type="button"
                disabled={isLockedOut || enteredPin.length === 0}
                onClick={() => setEnteredPin((prev) => prev.slice(0, -1))}
                className="min-h-[52px] rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Backspace"
              >
                <Delete className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
        <div />
      </div>
    </div>
  );
};
