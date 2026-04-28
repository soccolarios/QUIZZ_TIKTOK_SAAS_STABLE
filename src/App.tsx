import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PublicConfigProvider } from './context/PublicConfigContext';
import { UserConfigProvider } from './context/UserConfigContext';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
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
import { AdminApp } from './admin/AdminApp';
import type { NavPage } from './components/layout/Sidebar';
import type { Session } from './api/types';
import { isActiveStatus } from './utils/sessionStatus';

const isAdminMode =
  window.location.hostname.startsWith('admin.') ||
  window.location.pathname.startsWith('/admin');

type AuthView = 'login' | 'register' | 'forgot-password' | 'reset-password';

function AuthGate() {
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get('token');
  const isResetPath = window.location.pathname === '/reset-password';

  const [view, setView] = useState<AuthView>(
    isResetPath && resetToken ? 'reset-password' : 'login'
  );

  const handleResetDone = () => {
    window.history.replaceState({}, '', '/');
    setView('login');
  };

  if (view === 'reset-password' && resetToken) {
    return <ResetPasswordPage token={resetToken} onDone={handleResetDone} />;
  }
  if (view === 'forgot-password') {
    return <ForgotPasswordPage onBack={() => setView('login')} />;
  }
  if (view === 'register') {
    return <RegisterPage onSwitchToLogin={() => setView('login')} />;
  }
  return (
    <LoginPage
      onSwitchToRegister={() => setView('register')}
      onForgotPassword={() => setView('forgot-password')}
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

  if (isAdminMode) return <AdminApp />;

  if (loading) return <PageSpinner />;
  if (!user) return <AuthGate />;
  return (
    <UserConfigProvider>
      <Dashboard />
    </UserConfigProvider>
  );
}

export default function App() {
  return (
    <PublicConfigProvider>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </PublicConfigProvider>
  );
}
