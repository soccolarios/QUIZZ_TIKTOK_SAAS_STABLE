import { LayoutDashboard, Users, CreditCard, TrendingUp, PlayCircle, Key, Mail, Search, Globe, Settings, Tag, ToggleLeft, Music, Volume2, LayoutGrid as Layout, BookOpen, FileText, HelpCircle, Shield, BarChart2, Megaphone, AlertTriangle, ShieldCheck, Wrench, LogOut, ChevronDown, Zap } from 'lucide-react';
import { useState } from 'react';
import { useBrand } from '../context/PublicConfigContext';
import adminMenu from '../config/adminMenu';
import type { AdminMenuItem } from '../config/adminMenu';

export type AdminPage = string;

interface AdminSidebarProps {
  current: AdminPage;
  onChange: (page: AdminPage) => void;
  onLogout: () => void;
  userEmail: string;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  LayoutDashboard: <LayoutDashboard className="w-4 h-4" />,
  Users: <Users className="w-4 h-4" />,
  CreditCard: <CreditCard className="w-4 h-4" />,
  TrendingUp: <TrendingUp className="w-4 h-4" />,
  PlayCircle: <PlayCircle className="w-4 h-4" />,
  Key: <Key className="w-4 h-4" />,
  Mail: <Mail className="w-4 h-4" />,
  Search: <Search className="w-4 h-4" />,
  Globe: <Globe className="w-4 h-4" />,
  Settings: <Settings className="w-4 h-4" />,
  Tag: <Tag className="w-4 h-4" />,
  ToggleLeft: <ToggleLeft className="w-4 h-4" />,
  Music: <Music className="w-4 h-4" />,
  Volume2: <Volume2 className="w-4 h-4" />,
  Layout: <Layout className="w-4 h-4" />,
  BookOpen: <BookOpen className="w-4 h-4" />,
  FileText: <FileText className="w-4 h-4" />,
  HelpCircle: <HelpCircle className="w-4 h-4" />,
  Shield: <Shield className="w-4 h-4" />,
  BarChart2: <BarChart2 className="w-4 h-4" />,
  Megaphone: <Megaphone className="w-4 h-4" />,
  AlertTriangle: <AlertTriangle className="w-4 h-4" />,
  ShieldCheck: <ShieldCheck className="w-4 h-4" />,
  Wrench: <Wrench className="w-4 h-4" />,
};

function NavItem({ item, active, onClick }: { item: AdminMenuItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors text-left ${
        active
          ? 'bg-white/10 text-white'
          : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
      }`}
    >
      <span className="flex-shrink-0 opacity-75">{ICON_MAP[item.iconName] ?? <Settings className="w-4 h-4" />}</span>
      <span className="truncate">{item.label}</span>
    </button>
  );
}

export function AdminSidebar({ current, onChange, onLogout, userEmail }: AdminSidebarProps) {
  const brand = useBrand();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleSection = (label: string) => {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <aside className="w-60 bg-gray-950 flex flex-col min-h-screen border-r border-gray-800/50">
      {/* Brand header */}
      <div className="px-4 py-4 border-b border-gray-800/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-rose-500 to-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{brand.name}</p>
            <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Super Admin</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
        {adminMenu.map((section) => {
          const isCollapsed = collapsed[section.label] ?? false;
          const hasActive = section.items.some((item) => item.id === current);

          return (
            <div key={section.label}>
              {section.items.length === 1 && section.label === 'Overview' ? (
                <NavItem
                  item={section.items[0]}
                  active={current === section.items[0].id}
                  onClick={() => onChange(section.items[0].id)}
                />
              ) : (
                <>
                  <button
                    onClick={() => toggleSection(section.label)}
                    className={`w-full flex items-center justify-between px-3 py-2 mt-2 first:mt-0 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                      hasActive ? 'text-gray-300' : 'text-gray-500 hover:text-gray-400'
                    }`}
                  >
                    {section.label}
                    <ChevronDown className={`w-3 h-3 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-0.5">
                      {section.items.map((item) => (
                        <NavItem
                          key={item.id}
                          item={item}
                          active={current === item.id}
                          onClick={() => onChange(item.id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-gray-800/50 space-y-1">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="w-6 h-6 rounded-full bg-rose-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold text-rose-400">
              {userEmail.charAt(0).toUpperCase()}
            </span>
          </div>
          <span className="text-[11px] text-gray-500 truncate">{userEmail}</span>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
