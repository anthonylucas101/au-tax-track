import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type FinancialYear } from './api.js';

interface FyContextValue {
  loading: boolean;
  error: string | null;
  years: FinancialYear[];
  selected: FinancialYear | null;
  selectByLabel: (label: string) => void;
}

const FyContext = createContext<FyContextValue | null>(null);

const STORAGE_KEY = 'au-tax-tracker.selectedFyLabel';
const DEFAULT_LABEL = '2025-26';

export function FyProvider({ children }: { children: ReactNode }) {
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_LABEL;
    } catch {
      return DEFAULT_LABEL;
    }
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listFinancialYears()
      .then((rows) => {
        if (cancelled) return;
        setYears(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load financial years');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo<FinancialYear | null>(() => {
    if (years.length === 0) return null;
    const match = years.find((y) => y.label === selectedLabel);
    if (match) return match;
    return years[years.length - 1] ?? null;
  }, [years, selectedLabel]);

  function selectByLabel(label: string) {
    setSelectedLabel(label);
    try {
      localStorage.setItem(STORAGE_KEY, label);
    } catch {
      // ignore
    }
  }

  const value: FyContextValue = { loading, error, years, selected, selectByLabel };
  return <FyContext.Provider value={value}>{children}</FyContext.Provider>;
}

export function useFy(): FyContextValue {
  const ctx = useContext(FyContext);
  if (!ctx) throw new Error('useFy must be used within FyProvider');
  return ctx;
}
