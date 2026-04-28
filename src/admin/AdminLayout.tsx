import React from 'react';
import { AdminSidebar, type AdminPage } from './AdminSidebar';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';

interface AdminLayoutProps {
  children: React.ReactNode;
  currentPage: AdminPage;
  onNavigate: (page: AdminPage) => void;
  onLogout: () => void;
  userEmail: string;
}

let _addAdminToast: ((msg: string, type: 'success' | 'error' | 'info') => void) | null = null;

export function adminToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  _addAdminToast?.(message, type);
}

export function AdminLayout({ children, currentPage, onNavigate, onLogout, userEmail }: AdminLayoutProps) {
  const { toasts, addToast, dismiss } = useToast();
  _addAdminToast = addToast;

  return (
    <div className="flex min-h-screen bg-gray-100">
      <AdminSidebar
        current={currentPage}
        onChange={onNavigate}
        onLogout={onLogout}
        userEmail={userEmail}
      />
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
      </main>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
