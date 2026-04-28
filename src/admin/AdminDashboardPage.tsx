import {
  Users, CreditCard, PlayCircle, Activity, ArrowUpRight,
  TrendingUp, Clock, ShieldCheck,
} from 'lucide-react';
import { useBrand } from '../context/PublicConfigContext';

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  accent: string;
}

function StatCard({ label, value, sub, icon, accent }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-400">{sub}</p>
    </div>
  );
}

interface QuickLinkProps {
  label: string;
  description: string;
  onClick: () => void;
}

function QuickLink({ label, description, onClick }: QuickLinkProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between gap-3 p-4 rounded-xl border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm transition-all text-left group"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-800 group-hover:text-gray-900">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0 transition-colors" />
    </button>
  );
}

interface AdminDashboardPageProps {
  onNavigate: (page: string) => void;
}

export function AdminDashboardPage({ onNavigate }: AdminDashboardPageProps) {
  const brand = useBrand();

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Welcome back</h1>
        <p className="text-sm text-gray-500 mt-1">
          {brand.name} Super Admin overview. Modules below are placeholders until wired to live data.
        </p>
      </div>

      {/* Stat cards -- placeholder values */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Users"
          value="--"
          sub="Awaiting live data"
          icon={<Users className="w-4 h-4 text-blue-600" />}
          accent="bg-blue-50"
        />
        <StatCard
          label="Active Subscriptions"
          value="--"
          sub="Awaiting live data"
          icon={<CreditCard className="w-4 h-4 text-emerald-600" />}
          accent="bg-emerald-50"
        />
        <StatCard
          label="Sessions Today"
          value="--"
          sub="Awaiting live data"
          icon={<PlayCircle className="w-4 h-4 text-amber-600" />}
          accent="bg-amber-50"
        />
        <StatCard
          label="MRR"
          value="--"
          sub="Awaiting live data"
          icon={<TrendingUp className="w-4 h-4 text-rose-600" />}
          accent="bg-rose-50"
        />
      </div>

      {/* System status */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-800">System Status</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'API', status: 'Operational' },
            { label: 'WebSocket', status: 'Operational' },
            { label: 'Database', status: 'Operational' },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-100">
              <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="text-xs font-medium text-gray-700">{s.label}</span>
              <span className="text-xs text-gray-400 ml-auto">{s.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <QuickLink
            label="Manage Users"
            description="View accounts, change roles, suspend."
            onClick={() => onNavigate('users')}
          />
          <QuickLink
            label="Pricing Plans"
            description="Edit plan tiers, limits, and pricing."
            onClick={() => onNavigate('pricing-plans')}
          />
          <QuickLink
            label="Site Config"
            description="Update brand, tagline, and URLs."
            onClick={() => onNavigate('site-config')}
          />
          <QuickLink
            label="Feature Flags"
            description="Toggle features per plan."
            onClick={() => onNavigate('feature-flags')}
          />
          <QuickLink
            label="Security Logs"
            description="Review login attempts and alerts."
            onClick={() => onNavigate('security-logs')}
          />
          <QuickLink
            label="Maintenance Mode"
            description="Take the platform offline safely."
            onClick={() => onNavigate('maintenance-mode')}
          />
        </div>
      </div>

      {/* Footer hints */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 border border-gray-100">
        <div className="flex gap-1.5">
          <Clock className="w-4 h-4 text-gray-300" />
          <ShieldCheck className="w-4 h-4 text-gray-300" />
        </div>
        <p className="text-xs text-gray-400">
          All admin actions will be logged to Security Logs once the module is active.
        </p>
      </div>
    </div>
  );
}
