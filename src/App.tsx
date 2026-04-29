import { useState, useEffect, useMemo } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminApp } from './admin/AdminApp';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { QuizzesPage } from './pages/QuizzesPage';
import { AIGeneratorPage } from './pages/AIGeneratorPage';
import { SessionsPage } from './pages/SessionsPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { LiveControlPage } from './pages/LiveControlPage';
import { LaunchSessionPage, type LaunchPrefill } from './pages/LaunchSessionPage';
import { BillingPage } from './pages/BillingPage';
import { AccountPage } from './pages/AccountPage';
import { DashboardLayout, toast } from './components/layout/DashboardLayout';
import { PageSpinner } from './components/ui/Spinner';
import type { NavPage } from './components/layout/Sidebar';
import type { Session } from './api/types';
import { isActiveStatus } from './utils/sessionStatus';

type AuthView = 'landing' | 'login' | 'register';

function AuthGate({ defaultView }: { defaultView?: AuthView }) {
  const [view, setView] = useState<AuthView>(defaultView ?? 'landing');

  if (view === 'login') {
    return (
      <LoginPage
        onSwitchToRegister={() => setView('register')}
      />
    );
  }
  if (view === 'register') {
    return (
      <RegisterPage
        onSwitchToLogin={() => setView('login')}
      />
    );
  }
  return (
    <LandingPage
      onGetStarted={() => setView('register')}
      onLogin={() => setView('login')}
    />
  );
}

type SessionView = { session: Session; mode: 'live' | 'detail' } | null;

function Dashboard() {
  const [page, setPage] = useState<NavPage>('overview');
  const [sessionView, setSessionView] = useState<SessionView>(null);
  const [launchPrefill, setLaunchPrefill] = useState<LaunchPrefill | undefined>();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get('billing');
    if (billing === 'success') {
      setPage('billing');
      toast('Payment successful! Your plan has been upgraded.', 'success');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (billing === 'cancel') {
      toast('Checkout was cancelled. No charges were made.', 'info');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleNavigate = (p: NavPage) => {
    setPage(p);
    setSessionView(null);
  };

  const openSession = (s: Session) => {
    setSessionView({
      session: s,
      mode: isActiveStatus(s.status) ? 'live' : 'detail',
    });
  };

  const renderPage = () => {
    if (page === 'overview') return <OverviewPage onNavigate={handleNavigate} />;
    if (page === 'billing') return <BillingPage />;
    if (page === 'account') return <AccountPage onNavigate={handleNavigate} />;
    if (page === 'projects') return <ProjectsPage />;
    if (page === 'quizzes') return <QuizzesPage />;
    if (page === 'ai-generator') return <AIGeneratorPage />;

    if (page === 'launch') {
      return (
        <LaunchSessionPage
          prefill={launchPrefill}
          onLaunched={(session) => {
            setLaunchPrefill(undefined);
            setPage('sessions');
            setSessionView({ session, mode: 'live' });
          }}
        />
      );
    }

    if (page === 'sessions' && sessionView) {
      if (sessionView.mode === 'live') {
        return (
          <LiveControlPage
            sessionId={sessionView.session.id}
            onBack={() => setSessionView(null)}
            onViewDetail={() => setSessionView({ session: sessionView.session, mode: 'detail' })}
          />
        );
      }
      return (
        <SessionDetailPage
          sessionId={sessionView.session.id}
          onBack={() => setSessionView(null)}
        />
      );
    }

    return (
      <SessionsPage
        onViewDetail={openSession}
        onNavigateToLaunch={() => {
          setLaunchPrefill(undefined);
          setPage('launch');
        }}
        onRelaunch={(prefill) => {
          setLaunchPrefill(prefill);
          setPage('launch');
        }}
      />
    );
  };

  return (
    <DashboardLayout currentPage={page} onNavigate={handleNavigate}>
      {renderPage()}
    </DashboardLayout>
  );
}

function AppInner() {
  const { user, loading } = useAuth();
  const isAdminRoute = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('admin') === '1' || window.location.pathname === '/admin';
  }, []);

  if (loading) return <PageSpinner />;
  if (isAdminRoute) return <AdminApp />;
  if (!user) return <AuthGate />;
  return <Dashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
