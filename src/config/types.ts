export interface PlanConfig {
  code: string;
  name: string;
  price: string;
  period: string;
  tagline: string;
  description: string;
  recommended: boolean;
  cta: string;
  features: string[];
  limits: {
    maxActiveSessions: number;
    maxProjects: number;
    maxQuizzesPerProject: number;
  };
  flags: {
    x2Enabled: boolean;
    ttsEnabled: boolean;
    aiEnabled: boolean;
    musicEnabled: boolean;
  };
}

export interface BrandConfig {
  name: string;
  tagline: string;
  legalName: string;
  supportEmail: string;
  dashboardUrl: string;
}

export interface FeatureRow {
  label: string;
  hint?: string;
  values: Record<string, string | boolean>;
}

export interface FeatureGroup {
  groupLabel: string;
  iconName: string;
  rows: FeatureRow[];
}

export interface LandingFeature {
  iconName: string;
  title: string;
  description: string;
}

export interface LandingStep {
  step: string;
  title: string;
  description: string;
}

export interface FaqEntry {
  q: string;
  a: string;
}

export interface AiPresetCategory {
  code: string;
  label: string;
  emoji: string;
  theme: string;
  category: string;
}

export interface AiDifficultyLevel {
  value: number;
  label: string;
  description: string;
}

export interface AiQuestionStyle {
  id: string;
  label: string;
  desc: string;
}

export interface AiDefaults {
  categories: AiPresetCategory[];
  difficultyLevels: AiDifficultyLevel[];
  questionCounts: number[];
  questionStyles: AiQuestionStyle[];
  defaultLanguage: string;
  defaultModel: string;
}

export interface OverlayTemplate {
  value: string;
  label: string;
  hint: string;
}

export interface PlayModeOption {
  value: string;
  label: string;
  hint: string;
}

export interface SessionDefaults {
  questionTimerMin: number;
  questionTimerMax: number;
  questionTimerDefault: number;
  countdownMin: number;
  countdownMax: number;
  countdownDefault: number;
  overlayTemplates: OverlayTemplate[];
  playModes: PlayModeOption[];
}

export interface PublicConfig {
  brand: BrandConfig;
  plans: PlanConfig[];
  defaultPlanCode: string;
  featureGroups: FeatureGroup[];
  landing: {
    features: LandingFeature[];
    steps: LandingStep[];
    faq: FaqEntry[];
  };
  ai: AiDefaults;
  session: SessionDefaults;
}

export interface UserConfig {
  planCode: string;
  planLimits: PlanConfig['limits'];
  planFlags: PlanConfig['flags'];
}
