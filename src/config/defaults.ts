import type { PublicConfig } from './types';

const defaults: PublicConfig = {
  brand: {
    name: 'LiveGine',
    tagline: 'Interactive live quiz experiences for your audience',
    legalName: 'LiveGine SaaS',
    supportEmail: 'support@livegine.com',
    dashboardUrl: 'https://app.livegine.com',
  },

  defaultPlanCode: 'free',

  plans: [
    {
      code: 'free',
      name: 'Free',
      price: '$0',
      period: 'forever',
      tagline: 'Try the platform at no cost',
      description: 'Get started for free',
      recommended: false,
      cta: 'Get started',
      features: [
        '1 active session',
        '1 project',
        '3 quizzes',
        'Simulation mode',
        'OBS overlay',
      ],
      limits: {
        maxActiveSessions: 1,
        maxProjects: 1,
        maxQuizzesPerProject: 3,
      },
      flags: {
        x2Enabled: false,
        ttsEnabled: false,
        aiEnabled: false,
        musicEnabled: false,
      },
    },
    {
      code: 'pro',
      name: 'Pro',
      price: '$19',
      period: '/month',
      tagline: 'For creators going live regularly',
      description: 'For creators going live regularly',
      recommended: true,
      cta: 'Start free trial',
      features: [
        '5 active sessions',
        '10 projects',
        '50 quizzes',
        'X2 bonus mechanic',
        'TTS audio',
        'Full analytics',
      ],
      limits: {
        maxActiveSessions: 5,
        maxProjects: 10,
        maxQuizzesPerProject: 50,
      },
      flags: {
        x2Enabled: true,
        ttsEnabled: true,
        aiEnabled: true,
        musicEnabled: true,
      },
    },
    {
      code: 'premium',
      name: 'Premium',
      price: '$49',
      period: '/month',
      tagline: 'For agencies and power users',
      description: 'For agencies and power users',
      recommended: false,
      cta: 'Start free trial',
      features: [
        '20 active sessions',
        '100 projects',
        '500 quizzes',
        'Everything in Pro',
        'Priority support',
      ],
      limits: {
        maxActiveSessions: 20,
        maxProjects: 100,
        maxQuizzesPerProject: 500,
      },
      flags: {
        x2Enabled: true,
        ttsEnabled: true,
        aiEnabled: true,
        musicEnabled: true,
      },
    },
  ],

  featureGroups: [
    {
      groupLabel: 'Capacity',
      iconName: 'Layers',
      rows: [
        { label: 'Active sessions', values: { free: '1', pro: '5', premium: '20' } },
        { label: 'Projects', values: { free: '1', pro: '10', premium: '100' } },
        { label: 'Quizzes per project', values: { free: '3', pro: '50', premium: '500' } },
      ],
    },
    {
      groupLabel: 'Live features',
      iconName: 'RadioTower',
      rows: [
        { label: 'Simulation mode', values: { free: true, pro: true, premium: true } },
        { label: 'TikTok live mode', values: { free: true, pro: true, premium: true } },
        { label: 'Overlay URL', values: { free: true, pro: true, premium: true } },
        { label: 'Live control dashboard', values: { free: true, pro: true, premium: true } },
        { label: 'X2 bonus mechanic', hint: 'Double-score bonus round for top players', values: { free: false, pro: true, premium: true } },
      ],
    },
    {
      groupLabel: 'AI & audio',
      iconName: 'Cpu',
      rows: [
        { label: 'AI quiz generation', values: { free: false, pro: true, premium: true } },
        { label: 'TTS voice narration', hint: 'Questions read aloud during live sessions', values: { free: false, pro: true, premium: true } },
        { label: 'Music controls', values: { free: false, pro: true, premium: true } },
        { label: 'Audio volume control', values: { free: false, pro: true, premium: true } },
      ],
    },
    {
      groupLabel: 'History & data',
      iconName: 'Mic',
      rows: [
        { label: 'Session history', values: { free: true, pro: true, premium: true } },
        { label: 'Score persistence', values: { free: true, pro: true, premium: true } },
        { label: 'Activity logs', values: { free: true, pro: true, premium: true } },
      ],
    },
    {
      groupLabel: 'Support',
      iconName: 'HeartHandshake',
      rows: [
        { label: 'Community support', values: { free: true, pro: true, premium: true } },
        { label: 'Priority support', values: { free: false, pro: false, premium: true } },
      ],
    },
  ],

  landing: {
    features: [
      {
        iconName: 'MonitorPlay',
        title: 'Live overlay for OBS',
        description: 'Copy a single URL into OBS and your quiz appears instantly on stream. No complex setup.',
      },
      {
        iconName: 'Users',
        title: 'TikTok LIVE comments',
        description: 'Participants answer in chat. The engine reads comments in real time and validates answers.',
      },
      {
        iconName: 'Sparkles',
        title: 'X2 bonus mechanic',
        description: 'Activate a score multiplier mid-game to boost engagement and keep viewers hooked.',
      },
      {
        iconName: 'BarChart2',
        title: 'Session analytics',
        description: 'Track every session: participants, scores, timing. Know what works.',
      },
      {
        iconName: 'Globe',
        title: 'Simulation mode',
        description: 'Test your quiz without going live. Simulate answers and validate your setup safely.',
      },
      {
        iconName: 'Shield',
        title: 'Multi-project',
        description: 'Organise quizzes by project. Run different themes for different shows or audiences.',
      },
    ],
    steps: [
      { step: '01', title: 'Create your quiz', description: 'Add questions and answers in the dashboard. Takes 2 minutes.' },
      { step: '02', title: 'Copy the overlay URL', description: 'Paste it as a browser source in OBS. Size and position it.' },
      { step: '03', title: 'Go live on TikTok', description: 'Start your session from the dashboard. The engine connects automatically.' },
      { step: '04', title: 'Watch participants play', description: 'Viewers answer in chat. Scores update in real time on screen.' },
    ],
    faq: [
      {
        q: 'Do I need to install anything?',
        a: 'No. The dashboard is fully browser-based. Only OBS is needed on your streaming computer to display the overlay.',
      },
      {
        q: 'Can I test without going live?',
        a: 'Yes. Simulation mode lets you run a full quiz session without a TikTok LIVE, so you can rehearse and validate your setup.',
      },
      {
        q: 'What happens if I cancel my subscription?',
        a: 'Your account reverts to the Free plan at the end of the billing period. You keep access to your projects and quizzes.',
      },
      {
        q: 'Can I run multiple sessions at the same time?',
        a: 'Yes, on Pro and Premium plans. Each session runs in full isolation with its own overlay URL and quiz engine.',
      },
      {
        q: 'Is my data safe?',
        a: 'Yes. Each user\'s data is isolated. Sessions, quizzes and scores are stored securely and never shared.',
      },
    ],
  },

  ai: {
    categories: [
      { code: 'culture', label: 'Culture g\u00e9n\u00e9rale' },
      { code: 'sport', label: 'Sport' },
      { code: 'cinema', label: 'Cin\u00e9ma' },
      { code: 'sciences', label: 'Sciences' },
      { code: 'histoire', label: 'Histoire' },
      { code: 'musique', label: 'Musique' },
      { code: 'geographie', label: 'G\u00e9ographie' },
      { code: 'tech', label: 'Technologie' },
    ],
    difficultyLevels: [
      { value: 1, label: 'Facile', description: 'Questions accessibles \u00e0 tous' },
      { value: 2, label: 'Moyen', description: 'Niveau interm\u00e9diaire' },
      { value: 3, label: 'Difficile', description: 'Pour les experts' },
    ],
    questionCounts: [5, 10, 15, 20],
    questionStyles: ['Standard', 'Anecdotes', 'Chiffres', 'Personnalit\u00e9s'],
    defaultLanguage: 'fr',
    defaultModel: 'gpt-4o-mini',
  },

  session: {
    questionTimerMin: 5,
    questionTimerMax: 120,
    questionTimerDefault: 15,
    countdownMin: 3,
    countdownMax: 30,
    countdownDefault: 5,
    overlayTemplates: [
      { value: 'default', label: 'Default', hint: 'Animated gradient with depth orbs.' },
      { value: 'football', label: 'Football', hint: 'Stadium-themed sports design.' },
    ],
    playModes: [
      { value: 'single', label: 'Single quiz', hint: 'Play the selected quiz once.' },
      { value: 'loop_single', label: 'Loop this quiz', hint: 'Repeat the selected quiz continuously.' },
      { value: 'sequential', label: 'All quizzes', hint: 'Play all project quizzes in order, once.' },
      { value: 'loop_all', label: 'Loop all quizzes', hint: 'Cycle through all project quizzes continuously.' },
    ],
  },
};

export default defaults;
