import { LayoutDashboard, Users, CreditCard, TrendingUp, PlayCircle, Key, Mail, Search, Globe, Settings, Tag, ToggleLeft, Music, Volume2, LayoutGrid as Layout, BookOpen, FileText, HelpCircle, Shield, BarChart2, Megaphone, AlertTriangle, ShieldCheck, Wrench, Construction } from 'lucide-react';
import adminMenu from '../config/adminMenu';

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  LayoutDashboard, Users, CreditCard, TrendingUp, PlayCircle, Key, Mail,
  Search, Globe, Settings, Tag, ToggleLeft, Music, Volume2, Layout, BookOpen,
  FileText, HelpCircle, Shield, BarChart2, Megaphone, AlertTriangle,
  ShieldCheck, Wrench,
};

function findModule(id: string) {
  for (const section of adminMenu) {
    const item = section.items.find((i) => i.id === id);
    if (item) return { ...item, section: section.label };
  }
  return null;
}

export function AdminPlaceholderPage({ moduleId }: { moduleId: string }) {
  const mod = findModule(moduleId);
  if (!mod) return null;

  const Icon = ICON_MAP[mod.iconName] ?? Settings;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-gray-900 flex items-center justify-center">
            <Icon className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{mod.label}</h1>
            <p className="text-xs text-gray-400 font-medium">{mod.section}</p>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-2 max-w-lg">{mod.description}</p>
      </div>

      <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-12 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-5">
          <Construction className="w-7 h-7 text-gray-300" />
        </div>
        <h2 className="text-base font-semibold text-gray-700 mb-1">Coming soon</h2>
        <p className="text-sm text-gray-400 max-w-sm">
          This module will be managed from Super Admin. Configuration and management tools are being built.
        </p>
      </div>
    </div>
  );
}
