import { useState, useRef, useEffect, useCallback } from 'react';
import { Monitor, ExternalLink, Copy, Check, RefreshCw, Link, Wifi, WifiOff, Bot, Radio } from 'lucide-react';
import { toast } from './layout/DashboardLayout';

export type OverlayPreviewState =
  | 'unprepared'
  | 'prepared-simulation'
  | 'prepared-live-no-username'
  | 'prepared-live';

interface OverlayPreviewProps {
  overlayUrl: string | null;
  shortUrl: string | null;
  previewState?: OverlayPreviewState;
  muted?: boolean;
}

const NATIVE_W = 1080;
const NATIVE_H = 1920;

export function OverlayPreview({ overlayUrl, shortUrl, previewState = 'unprepared', muted = false }: OverlayPreviewProps) {
  const [copied, setCopied] = useState<'long' | 'short' | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setScale(w / NATIVE_W);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'preview_mute', muted }, '*');
  }, [muted]);

  const handleIframeLoad = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'preview_mute', muted }, '*');
  }, [muted]);

  const copy = (text: string, kind: 'long' | 'short') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(kind);
      toast('Copied to clipboard', 'success');
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Preview frame */}
      <div
        ref={wrapperRef}
        className="relative rounded-2xl overflow-hidden border shadow-sm w-full"
        style={{ height: NATIVE_H * scale, background: '#0a0a0f' }}
      >
        {overlayUrl ? (
          <>
            <iframe
              key={reloadKey}
              ref={iframeRef}
              src={overlayUrl}
              width={NATIVE_W}
              height={NATIVE_H}
              title="Overlay preview"
              allow="autoplay"
              onLoad={handleIframeLoad}
              style={{
                display: 'block',
                transformOrigin: 'top left',
                transform: `scale(${scale})`,
                border: 'none',
                pointerEvents: 'none',
              }}
            />
            {/* Pre-launch status overlay on top of iframe */}
            <PreLaunchOverlay state={previewState} />
            <button
              onClick={() => setReloadKey(k => k + 1)}
              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-lg bg-black/50 hover:bg-black/70 text-white transition-colors z-20"
              title="Reload preview"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <UnpreparedPlaceholder />
        )}
      </div>

      {/* URL rows */}
      <div className="flex flex-col gap-2">
        <UrlRow
          label="Overlay URL"
          url={overlayUrl}
          copied={copied === 'long'}
          onCopy={() => overlayUrl && copy(overlayUrl, 'long')}
          openExternal
        />
        {shortUrl && (
          <UrlRow
            label="Short link"
            url={shortUrl}
            copied={copied === 'short'}
            onCopy={() => copy(shortUrl, 'short')}
            icon={<Link className="w-3 h-3" />}
            highlight
          />
        )}
      </div>

      {overlayUrl && (
        <p className="text-xs text-gray-400 leading-relaxed">
          Add this URL as a Browser Source in OBS. The overlay will appear
          as soon as the game starts — it is safe to add it before launching.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder shown before any session is prepared
// ---------------------------------------------------------------------------

function UnpreparedPlaceholder() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
      <div className="w-14 h-14 rounded-2xl bg-gray-800 flex items-center justify-center">
        <Monitor className="w-7 h-7 text-gray-600" />
      </div>
      <div className="text-center px-6">
        <p className="text-sm font-medium text-gray-400">No overlay ready</p>
        <p className="text-xs text-gray-600 mt-1">
          Click <span className="text-gray-400 font-semibold">Prepare Session</span> to generate
          your overlay URL and preview it here.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge shown on top of the live iframe once a session is prepared
// ---------------------------------------------------------------------------

interface PreLaunchOverlayProps {
  state: OverlayPreviewState;
}

const PRELAUNCH_CONFIGS = {
  'prepared-simulation': {
    icon: <Bot className="w-4 h-4 text-blue-300" />,
    label: 'Simulation ready',
    sub: 'Waiting for game start',
    dotColor: 'bg-blue-400',
    badgeBg: 'bg-blue-950/80',
    badgeText: 'text-blue-200',
  },
  'prepared-live-no-username': {
    icon: <WifiOff className="w-4 h-4 text-amber-300" />,
    label: 'TikTok username required',
    sub: 'Enter your username to launch',
    dotColor: 'bg-amber-400',
    badgeBg: 'bg-amber-950/80',
    badgeText: 'text-amber-200',
  },
  'prepared-live': {
    icon: <Radio className="w-4 h-4 text-emerald-300" />,
    label: 'Overlay active',
    sub: 'Connecting to TikTok…',
    dotColor: 'bg-emerald-400',
    badgeBg: 'bg-emerald-950/80',
    badgeText: 'text-emerald-200',
  },
} as const;

function PreLaunchOverlay({ state }: PreLaunchOverlayProps) {
  if (!state || state === 'unprepared') return null;

  const cfg = PRELAUNCH_CONFIGS[state as keyof typeof PRELAUNCH_CONFIGS] || {
    icon: null,
    label: 'Loading...',
    sub: '',
    dotColor: 'bg-gray-300',
    badgeBg: 'bg-gray-100',
    badgeText: 'text-gray-500',
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-end pb-4 pointer-events-none">
      {/* Centered "waiting" message */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${cfg.dotColor} animate-pulse`} />
            <span className="text-[11px] font-semibold text-white/70 uppercase tracking-widest">
              Waiting for game start
            </span>
          </div>
        </div>
      </div>

      {/* Bottom status badge */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${cfg.badgeBg} border border-white/10 backdrop-blur-sm`}>
        {cfg.icon}
        <div>
          <span className={`text-xs font-semibold ${cfg.badgeText}`}>{cfg.label}</span>
          <span className="text-[10px] text-white/40 ml-1.5">{cfg.sub}</span>
        </div>
        <Wifi className="w-3 h-3 text-white/30 ml-1" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// URL row
// ---------------------------------------------------------------------------

interface UrlRowProps {
  label: string;
  url: string | null;
  copied: boolean;
  onCopy: () => void;
  openExternal?: boolean;
  highlight?: boolean;
  icon?: React.ReactNode;
}

function UrlRow({ label, url, copied, onCopy, openExternal, highlight, icon }: UrlRowProps) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 flex items-center gap-2 ${
      highlight ? 'border-blue-200 bg-blue-50/60' : 'border-gray-200 bg-gray-50'
    }`}>
      <span className={`text-[11px] font-semibold uppercase tracking-wide flex-shrink-0 ${
        highlight ? 'text-blue-500' : 'text-gray-400'
      }`}>
        {icon || null}
        {!icon && label}
      </span>
      {icon && (
        <span className={`text-[11px] font-semibold uppercase tracking-wide flex-shrink-0 ${
          highlight ? 'text-blue-500' : 'text-gray-400'
        }`}>
          {label}
        </span>
      )}
      <span className="flex-1 min-w-0 text-xs font-mono truncate text-gray-600">
        {url ?? '—'}
      </span>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onCopy}
          disabled={!url}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-30"
          title="Copy"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        {openExternal && url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
