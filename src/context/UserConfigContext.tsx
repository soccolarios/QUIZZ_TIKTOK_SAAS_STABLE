import React, { createContext, useContext, useMemo } from 'react';
import type { UserConfig, PlanConfig } from '../config/types';
import { usePublicConfig } from './PublicConfigContext';
import { useAuth } from './AuthContext';

const fallbackLimits: PlanConfig['limits'] = {
  maxActiveSessions: 1,
  maxProjects: 1,
  maxQuizzesPerProject: 3,
};

const fallbackFlags: PlanConfig['flags'] = {
  x2Enabled: false,
  ttsEnabled: false,
  aiEnabled: false,
  musicEnabled: false,
};

const fallbackUserConfig: UserConfig = {
  planCode: 'free',
  planLimits: fallbackLimits,
  planFlags: fallbackFlags,
};

const UserConfigContext = createContext<UserConfig>(fallbackUserConfig);

export function UserConfigProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { plans, defaultPlanCode } = usePublicConfig();

  const userConfig = useMemo<UserConfig>(() => {
    const code = user?.plan_code || defaultPlanCode;
    const plan = plans.find((p) => p.code === code) ?? plans.find((p) => p.code === defaultPlanCode);
    if (!plan) return fallbackUserConfig;
    return {
      planCode: plan.code,
      planLimits: plan.limits,
      planFlags: plan.flags,
    };
  }, [user?.plan_code, plans, defaultPlanCode]);

  return (
    <UserConfigContext.Provider value={userConfig}>
      {children}
    </UserConfigContext.Provider>
  );
}

export function useUserConfig(): UserConfig {
  return useContext(UserConfigContext);
}

export function usePlanLimits() {
  return useContext(UserConfigContext).planLimits;
}

export function usePlanFlags() {
  return useContext(UserConfigContext).planFlags;
}
