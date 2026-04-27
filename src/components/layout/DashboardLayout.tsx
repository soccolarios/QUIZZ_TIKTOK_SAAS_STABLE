import React from 'react';
import { Sidebar, type NavPage } from './Sidebar';
import { ToastContainer } from '../ui/Toast';
import { useToast } from '../../hooks/useToast';

interface DashboardLayoutProps {
  children: React.ReactNode;
  currentPage: NavPage;
  onNavigate: (page: NavPage) => void;
}

let _addToast: ((msg: string, type: 'success' | 'error' | 'info') => void) | null = null;

export function toast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  _addToast?.(message, type);
}

export function DashboardLayout({ children, currentPage, onNavigate }: DashboardLayoutProps) {
  const { toasts, addToast, dismiss } = useToast();
  _addToast = addToast;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar current={currentPage} onChange={onNavigate} />
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">{children}</div>
      </main>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
