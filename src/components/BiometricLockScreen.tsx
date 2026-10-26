import React, { useState } from 'react';
import { Fingerprint, Lock, ShieldCheck, AlertCircle, Delete, Sun, Moon } from 'lucide-react';
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

  const targetPin = pinCode || '2026';

  const handleBiometricVerify = async () => {
    setErrorMessage(null);
    setIsScanning(true);
    setStatusMessage('Biometric စစ်ဆေးနေပါသည်...');

    const result = await verifyBiometricPasskey(passkeyId || 'sim_bio_default');
    setIsScanning(false);

    if (result.verified) {
      setStatusMessage('အတည်ပြုပြီးပါပြီ။ ဖွင့်နေပါသည်...');
      setTimeout(() => {
        onUnlock();
      }, 120);
    } else {
      setStatusMessage(null);
      setErrorMessage('Biometric မအောင်မြင်ပါ။ PIN နံပါတ်ဖြင့် ဖွင့်ပေးပါ။');
    }
  };

  const handleKeypadDigit = (digit: string) => {
    setErrorMessage(null);
    if (enteredPin.length < 6) {
      const next = enteredPin + digit;
      setEnteredPin(next);
      if (next === targetPin) {
        setTimeout(() => onUnlock(), 100);
      } else if (next.length >= targetPin.length && next.length >= 4) {
        setErrorMessage(`PIN မှားနေပါသည်။ (မူလ PIN မှာ ${targetPin} ဖြစ်ပါသည်)`);
        setTimeout(() => setEnteredPin(''), 400);
      }
    }
  };

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

            {errorMessage && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center justify-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="text-center mb-4">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                PIN နံပါတ် ရိုက်ထည့်ပါ (Default:{' '}
                <span className="font-mono-tabular font-semibold text-slate-700 dark:text-slate-200">
                  2026
                </span>
                )
              </div>
              <div className="flex items-center justify-center gap-3 h-8">
                {Array.from({ length: Math.max(4, targetPin.length) }).map((_, idx) => {
                  const filled = idx < enteredPin.length;
                  return (
                    <div
                      key={idx}
                      className={`w-3.5 h-3.5 rounded-full transition-colors ${
                        filled ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-slate-200 dark:bg-slate-800'
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
                  onClick={() => handleKeypadDigit(digit)}
                  className="min-h-[52px] rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 font-mono-tabular text-lg font-semibold text-slate-800 dark:text-slate-100 transition-colors cursor-pointer"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setEnteredPin('')}
                className="min-h-[52px] rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 transition-colors cursor-pointer"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => handleKeypadDigit('0')}
                className="min-h-[52px] rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 font-mono-tabular text-lg font-semibold text-slate-800 dark:text-slate-100 transition-colors cursor-pointer"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setEnteredPin((prev) => prev.slice(0, -1))}
                className="min-h-[52px] rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
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
