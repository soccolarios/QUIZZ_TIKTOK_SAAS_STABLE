import { useState } from 'react';
import { Zap, ArrowLeft, Mail } from 'lucide-react';
import { useBrand } from '../context/PublicConfigContext';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';

interface ForgotPasswordPageProps {
  onBack: () => void;
}

export function ForgotPasswordPage({ onBack }: ForgotPasswordPageProps) {
  const brand = useBrand();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    setLoading(true);
    try {
      await authApi.requestReset(email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-xl mb-4">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{brand.name}</h1>
          <p className="text-sm text-gray-500 mt-1">Reset your password</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {sent ? (
            <div className="text-center py-2">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-emerald-50 rounded-full mb-4">
                <Mail className="w-5 h-5 text-emerald-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Check your email</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                If an account exists for <strong className="text-gray-700">{email}</strong>, we sent a password reset link. It expires in 30 minutes.
              </p>
              <Button onClick={onBack} variant="secondary" className="mt-6 w-full">
                Back to sign in
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-4">
                Enter your email and we'll send you a link to reset your password.
              </p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <Input
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  required
                />
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
                <Button type="submit" loading={loading} className="w-full">
                  Send reset link
                </Button>
              </form>
            </>
          )}
        </div>

        {!sent && (
          <p className="text-center text-sm text-gray-500 mt-5">
            <button onClick={onBack} className="text-blue-600 hover:underline font-medium inline-flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to sign in
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
