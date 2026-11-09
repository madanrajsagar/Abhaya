import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ReportContext = createContext(null);

const STORAGE_KEY = '@abhaya_latest_report_v1';

export function ReportProvider({ children }) {
  const [latestReport, setLatestReportState] = useState(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          setLatestReportState(JSON.parse(raw));
        }
      } catch {
        setLatestReportState(null);
      } finally {
        setHydrated(true);
      }
    };

    hydrate();
  }, []);

  const setLatestReport = useCallback(async (report) => {
    setLatestReportState(report || null);
    try {
      if (report) {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(report));
      } else {
        await AsyncStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  }, []);

  const clearLatestReport = useCallback(async () => {
    await setLatestReport(null);
  }, [setLatestReport]);

  const value = useMemo(
    () => ({
      hydrated,
      latestReport,
      setLatestReport,
      clearLatestReport,
    }),
    [hydrated, latestReport, setLatestReport, clearLatestReport]
  );

  return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>;
}

export const useReport = () => {
  const context = useContext(ReportContext);
  if (!context) {
    throw new Error('useReport must be used within a ReportProvider');
  }
  return context;
};

