import React, { createContext, useContext, useEffect, useState } from 'react';
import type { PublicConfig } from '../config/types';
import defaults from '../config/defaults';
import { fetchPublicConfig } from '../api/config';

const PublicConfigContext = createContext<PublicConfig>(defaults);

export function PublicConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PublicConfig>(defaults);

  useEffect(() => {
    let cancelled = false;
    fetchPublicConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <PublicConfigContext.Provider value={config}>
      {children}
    </PublicConfigContext.Provider>
  );
}

export function usePublicConfig(): PublicConfig {
  return useContext(PublicConfigContext);
}

export function useBrand() {
  return useContext(PublicConfigContext).brand;
}

export function usePlans() {
  const cfg = useContext(PublicConfigContext);
  return { plans: cfg.plans, defaultPlanCode: cfg.defaultPlanCode };
}

export function useFeatureGroups() {
  return useContext(PublicConfigContext).featureGroups;
}

export function useLandingContent() {
  return useContext(PublicConfigContext).landing;
}

export function useAiDefaults() {
  return useContext(PublicConfigContext).ai;
}

export function useSessionDefaults() {
  return useContext(PublicConfigContext).session;
}
