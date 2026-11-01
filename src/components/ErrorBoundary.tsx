import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readableMessage = error.message || 'မမျှော်လင့်ထားသော အမှားတစ်ခု ဖြစ်ပေါ်နေပါသည်။';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && parsed.error) {
        readableMessage = `${parsed.error} (${parsed.operationType || 'operation'})`;
      }
    } catch {
      // keep raw message
    }
    return {
      hasError: true,
      errorMessage: readableMessage,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught application error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="text-base font-bold">
              စနစ်အတွင်း အမှားအယွင်းတစ်ခု တွေ့ရှိရပါသည်
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 break-words bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 font-mono-tabular">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
              className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>စာမျက်နှာ ပြန်လည်ဖွင့်မည်</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
