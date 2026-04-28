import { useState } from 'react';
import {
  Zap, Play, BarChart2, Users, CheckCircle, ChevronDown,
  ArrowRight, MonitorPlay, Sparkles, Globe, Shield, Clock,
} from 'lucide-react';
import { useBrand, usePlans, useLandingContent } from '../context/PublicConfigContext';

interface LandingPageProps {
  onGetStarted: () => void;
  onLogin: () => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  MonitorPlay: <MonitorPlay className="w-6 h-6 text-blue-600" />,
  Users:       <Users className="w-6 h-6 text-blue-600" />,
  Sparkles:    <Sparkles className="w-6 h-6 text-blue-600" />,
  BarChart2:   <BarChart2 className="w-6 h-6 text-blue-600" />,
  Globe:       <Globe className="w-6 h-6 text-blue-600" />,
  Shield:      <Shield className="w-6 h-6 text-blue-600" />,
};

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-200 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 text-left gap-4 hover:text-blue-600 transition-colors"
      >
        <span className="text-sm font-medium text-gray-900">{q}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="text-sm text-gray-500 pb-4 leading-relaxed">{a}</p>}
    </div>
  );
}

export function LandingPage({ onGetStarted, onLogin }: LandingPageProps) {
  const brand = useBrand();
  const { plans } = usePlans();
  const { features, steps, faq } = useLandingContent();

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-gray-900 text-sm">{brand.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onLogin}
              className="text-sm text-gray-500 hover:text-gray-900 font-medium transition-colors px-3 py-1.5"
            >
              Log in
            </button>
            <button
              onClick={onGetStarted}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-1.5 rounded-lg transition-colors"
            >
              Get started
            </button>
          </div>
        </div>
      </nav>

      <section className="pt-28 pb-20 px-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/60 to-white pointer-events-none" />
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full mb-6">
            <Play className="w-3 h-3" />
            {brand.tagline}
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight text-gray-900 leading-tight mb-5">
            Run live quizzes on{' '}
            <span className="text-blue-600">TikTok LIVE</span>
            <br />
            directly in OBS
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed max-w-xl mx-auto mb-8">
            Create quizzes, launch sessions, and let your viewers compete in real time through chat.
            No coding, no plugins — just a URL in OBS.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={onGetStarted}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm shadow-sm"
            >
              Start for free
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={onLogin}
              className="text-sm text-gray-500 hover:text-gray-900 font-medium px-5 py-3 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors"
            >
              Already have an account
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-4">Free forever. No credit card required.</p>
        </div>
      </section>

      <section className="py-16 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-gray-900">Everything you need to engage your audience</h2>
            <p className="text-sm text-gray-500 mt-2">Built specifically for TikTok LIVE streamers</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {features.map((f) => (
              <div key={f.title} className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                <div className="w-10 h-10 bg-white rounded-lg shadow-sm flex items-center justify-center mb-3 border border-gray-100">
                  {ICON_MAP[f.iconName] ?? <Zap className="w-6 h-6 text-blue-600" />}
                </div>
                <p className="font-semibold text-gray-900 text-sm mb-1">{f.title}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-gray-900">Live in 4 steps</h2>
            <p className="text-sm text-gray-500 mt-2">From zero to quiz in under 5 minutes</p>
          </div>
          <div className="relative">
            <div className="hidden md:block absolute top-5 left-0 right-0 h-px bg-gray-200 mx-16" />
            <div className="grid md:grid-cols-4 gap-6">
              {steps.map((s) => (
                <div key={s.step} className="relative text-center">
                  <div className="w-10 h-10 bg-white border-2 border-blue-600 rounded-full flex items-center justify-center text-blue-600 font-bold text-xs mx-auto mb-3 relative z-10">
                    {s.step}
                  </div>
                  <p className="font-semibold text-gray-900 text-sm mb-1">{s.title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{s.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 px-6 bg-white" id="pricing">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-gray-900">Simple, transparent pricing</h2>
            <p className="text-sm text-gray-500 mt-2">Start free. Upgrade when you grow.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {plans.map((plan) => (
              <div
                key={plan.code}
                className={`rounded-xl border-2 p-6 flex flex-col gap-4 ${plan.recommended ? 'border-blue-500 shadow-lg' : 'border-gray-200'}`}
              >
                {plan.recommended && (
                  <div className="text-center -mt-9 mb-1">
                    <span className="bg-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                      Most popular
                    </span>
                  </div>
                )}
                <div>
                  <p className="font-bold text-gray-900">{plan.name}</p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-extrabold text-gray-900">{plan.price}</span>
                    <span className="text-sm text-gray-400">{plan.period}</span>
                  </div>
                </div>
                <ul className="flex flex-col gap-2 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={onGetStarted}
                  className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                    plan.recommended
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'border border-gray-200 hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-6 bg-gray-50">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-gray-900">Frequently asked questions</h2>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 px-6">
            {faq.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 bg-blue-600 text-white text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl font-extrabold mb-3">Ready to go live?</h2>
          <p className="text-blue-100 text-sm mb-8">
            Join streamers already using {brand.name} to engage their audience every session.
          </p>
          <button
            onClick={onGetStarted}
            className="inline-flex items-center gap-2 bg-white text-blue-600 font-bold px-7 py-3 rounded-xl hover:bg-blue-50 transition-colors text-sm shadow-sm"
          >
            Create free account
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      <footer className="py-8 px-6 border-t border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center">
              <Zap className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-700">{brand.name}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-400">
              <Clock className="w-3 h-3 inline mr-1" />
              Made for live streamers
            </span>
          </div>
          <p className="text-xs text-gray-400">&copy; {new Date().getFullYear()} {brand.legalName}</p>
        </div>
      </footer>
    </div>
  );
}
