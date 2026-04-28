export interface AdminMenuSection {
  label: string;
  items: AdminMenuItem[];
}

export interface AdminMenuItem {
  id: string;
  label: string;
  iconName: string;
  description: string;
}

const adminMenu: AdminMenuSection[] = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', iconName: 'LayoutDashboard', description: 'Platform health, key metrics, and quick actions.' },
    ],
  },
  {
    label: 'Users & Revenue',
    items: [
      { id: 'users', label: 'Users', iconName: 'Users', description: 'Manage registered users, roles, and account status.' },
      { id: 'subscriptions', label: 'Subscriptions', iconName: 'CreditCard', description: 'Active subscriptions, plan changes, and cancellations.' },
      { id: 'revenue', label: 'Revenue', iconName: 'TrendingUp', description: 'MRR, churn, and payment history.' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { id: 'sessions', label: 'Sessions', iconName: 'PlayCircle', description: 'All live and past sessions across users.' },
      { id: 'api-keys', label: 'API Keys', iconName: 'Key', description: 'Manage platform API keys and service tokens.' },
      { id: 'mailjet', label: 'Mailjet', iconName: 'Mail', description: 'Transactional email templates and delivery logs.' },
    ],
  },
  {
    label: 'Content',
    items: [
      { id: 'seo', label: 'SEO', iconName: 'Search', description: 'Meta tags, sitemap, and social previews.' },
      { id: 'languages', label: 'Languages', iconName: 'Globe', description: 'Supported languages and translation keys.' },
      { id: 'site-config', label: 'Site Config', iconName: 'Settings', description: 'Brand name, tagline, URLs, and global settings.' },
      { id: 'pricing-plans', label: 'Pricing Plans', iconName: 'Tag', description: 'Plan tiers, pricing, limits, and feature flags.' },
      { id: 'feature-flags', label: 'Feature Flags', iconName: 'ToggleLeft', description: 'Toggle features on/off per plan or globally.' },
    ],
  },
  {
    label: 'Media & Assets',
    items: [
      { id: 'music-bank', label: 'Music Bank', iconName: 'Music', description: 'Background music tracks available to users.' },
      { id: 'sound-bank', label: 'Sound Bank', iconName: 'Volume2', description: 'Sound effects for quiz events.' },
      { id: 'templates', label: 'Templates', iconName: 'Layout', description: 'Overlay templates and visual themes.' },
      { id: 'quiz-library', label: 'Quiz Library', iconName: 'BookOpen', description: 'Curated quiz packs and community content.' },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { id: 'blog', label: 'Blog', iconName: 'FileText', description: 'Blog posts and content management.' },
      { id: 'faq', label: 'FAQ', iconName: 'HelpCircle', description: 'Frequently asked questions shown on the landing page.' },
      { id: 'legal', label: 'Legal', iconName: 'Shield', description: 'Terms of service, privacy policy, and legal pages.' },
      { id: 'analytics-scripts', label: 'Analytics Scripts', iconName: 'BarChart2', description: 'Third-party tracking and analytics snippets.' },
      { id: 'announcements', label: 'Announcements', iconName: 'Megaphone', description: 'In-app banners and notification broadcasts.' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'maintenance-mode', label: 'Maintenance Mode', iconName: 'AlertTriangle', description: 'Enable/disable maintenance mode for the platform.' },
      { id: 'security-logs', label: 'Security Logs', iconName: 'ShieldCheck', description: 'Login attempts, suspicious activity, and audit trail.' },
      { id: 'system-settings', label: 'System Settings', iconName: 'Wrench', description: 'Server configuration, caching, and advanced options.' },
    ],
  },
];

export default adminMenu;
