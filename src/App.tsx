import { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Download, LocateFixed, Menu, Play, Share2, Square, Vibrate, Volume2, X } from 'lucide-react';

interface BangAlarmPluginInterface {
  syncAlarms(options: { scheduleJson: string }): Promise<{ scheduled: boolean }>;
  stopAdhan(): Promise<void>;
  requestAlarmPermissions(): Promise<void>;
}

const BangAlarm = registerPlugin<BangAlarmPluginInterface>('BangAlarm');

type AlertMode = 'adhan' | 'vibrate';

interface PrayerEntry {
  id: string;
  label: string;
  displayTime: string;
  hour24: number;
  minute: number;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const CITY_NAME = 'شێلادزێ';
const ADHAN_AUDIO_SRC = '/assets/aistudio/bang_echo_smooth_4cb641d5.mp3';
const TELEGRAM_URL = 'https://t.me/osamanzeermustafa';
const STORAGE_KEY = 'bang_shiladze_alert_modes_v1';

const PRAYER_SCHEDULE: PrayerEntry[] = [
  { id: 'fajr', label: 'سپێدە', displayTime: '05:17', hour24: 5, minute: 17 },
  { id: 'sunrise', label: 'روژهەلات', displayTime: '06:49', hour24: 6, minute: 49 },
  { id: 'dhuhr', label: 'نیڤرو', displayTime: '12:00', hour24: 12, minute: 0 },
  { id: 'asr', label: 'ئیڤار', displayTime: '02:41', hour24: 14, minute: 41 },
  { id: 'maghrib', label: 'مەغرەب', displayTime: '04:59', hour24: 16, minute: 59 },
  { id: 'isha', label: 'عەیشا', displayTime: '06:20', hour24: 18, minute: 20 },
];

const DEFAULT_ALERT_MODES: Record<string, AlertMode> = {
  fajr: 'adhan',
  sunrise: 'adhan',
  dhuhr: 'adhan',
  asr: 'adhan',
  maghrib: 'adhan',
  isha: 'adhan',
};

const BADINI_WEEKDAYS: Record<string, string> = {
  Sun: 'ئێکشەمبی',
  Mon: 'دووشەمبی',
  Tue: 'سێشەمبی',
  Wed: 'چوارشەمبی',
  Thu: 'پێنجشەمبی',
  Fri: 'ئەینی',
  Sat: 'شەمبی',
};

const pad2 = (value: number) => String(value).padStart(2, '0');

function loadSavedModes(): Record<string, AlertMode> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ALERT_MODES;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, AlertMode> = { ...DEFAULT_ALERT_MODES };
    for (const prayer of PRAYER_SCHEDULE) {
      if (parsed[prayer.id] === 'adhan' || parsed[prayer.id] === 'vibrate') {
        next[prayer.id] = parsed[prayer.id] as AlertMode;
      }
    }
    return next;
  } catch {
    return DEFAULT_ALERT_MODES;
  }
}

function getBaghdadTimeParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Baghdad',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const hour24 = Number(map.hour) % 24;
  const minute = Number(map.minute);
  const second = Number(map.second);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  const weekdayShort = map.weekday ?? 'Sat';
  const weekdayKurdish = BADINI_WEEKDAYS[weekdayShort] ?? 'شەمبی';
  const gregorianDate = `${map.day}/${map.month}/${map.year}`;
  const liveClock12 = `${pad2(hour12)}:${pad2(minute)}:${pad2(second)}`;

  const hijriParts = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {
    timeZone: 'Asia/Baghdad',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(date);

  const hijriDay = hijriParts.find((p) => p.type === 'day')?.value ?? '';
  const hijriMonth = hijriParts.find((p) => p.type === 'month')?.value ?? '';
  const hijriYear = hijriParts.find((p) => p.type === 'year')?.value ?? '';
  const hijriDate = `${hijriDay} ${hijriMonth} ${hijriYear}`.trim();

  return {
    hour24,
    minute,
    second,
    liveClock12,
    weekdayKurdish,
    gregorianDate,
    hijriDate,
  };
}

function getNextPrayerInfo(hour24: number, minute: number, second: number) {
  const nowSeconds = hour24 * 3600 + minute * 60 + second;
  const scheduleSeconds = PRAYER_SCHEDULE.map((p) => p.hour24 * 3600 + p.minute * 60);

  let nextIdx = scheduleSeconds.findIndex((s) => s > nowSeconds);
  let prevSeconds: number;
  let targetSeconds: number;

  if (nextIdx === -1) {
    nextIdx = 0;
    prevSeconds = scheduleSeconds[scheduleSeconds.length - 1];
    targetSeconds = scheduleSeconds[0] + 24 * 3600;
  } else if (nextIdx === 0) {
    prevSeconds = scheduleSeconds[scheduleSeconds.length - 1] - 24 * 3600;
    targetSeconds = scheduleSeconds[0];
  } else {
    prevSeconds = scheduleSeconds[nextIdx - 1];
    targetSeconds = scheduleSeconds[nextIdx];
  }

  const remainingSeconds = Math.max(0, targetSeconds - nowSeconds);
  const totalSpanSeconds = Math.max(1, targetSeconds - prevSeconds);
  const elapsedSeconds = Math.max(0, nowSeconds - prevSeconds);
  const progressPercent = Math.min(100, Math.max(0, (elapsedSeconds / totalSpanSeconds) * 100));

  const remH = Math.floor(remainingSeconds / 3600);
  const remM = Math.floor((remainingSeconds % 3600) / 60);
  const remS = remainingSeconds % 60;

  return {
    nextPrayer: PRAYER_SCHEDULE[nextIdx],
    countdown: `${pad2(remH)}:${pad2(remM)}:${pad2(remS)}`,
    progressPercent,
  };
}

function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export default function App() {
  const [now, setNow] = useState<Date>(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const [alertModes, setAlertModes] = useState<Record<string, AlertMode>>(loadSavedModes);
  const [isPlayingAdhan, setIsPlayingAdhan] = useState(false);
  const [activePrayerAlert, setActivePrayerAlert] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [installGuide, setInstallGuide] = useState<string | null>(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);

  const isNativeAndroid = Capacitor.isNativePlatform();
  const { isInstalled } = usePWAInstall();
  const hideApkButton = isNativeAndroid || isInstalled;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastTriggeredRef = useRef<string>('');

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(alertModes));
    } catch {
      // Ignore storage write failure
    }

    if (Capacitor.isNativePlatform()) {
      const payload = PRAYER_SCHEDULE.map((p) => ({
        id: p.id,
        label: p.label,
        hour24: p.hour24,
        minute: p.minute,
        mode: alertModes[p.id] ?? 'adhan',
      }));
      void BangAlarm.syncAlarms({ scheduleJson: JSON.stringify(payload) }).catch(() => {
        // Ignore if native bridge is unavailable
      });
    }
  }, [alertModes]);

  useEffect(() => {
    if (!menuOpen && !showDownloadModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDownloadModal(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen, showDownloadModal]);

  const timeParts = useMemo(() => getBaghdadTimeParts(now), [now]);
  const nextInfo = useMemo(
    () => getNextPrayerInfo(timeParts.hour24, timeParts.minute, timeParts.second),
    [timeParts.hour24, timeParts.minute, timeParts.second]
  );

  const playAdhanAudio = async (prayerLabel?: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioError(null);
    try {
      audio.currentTime = 0;
      await audio.play();
      setIsPlayingAdhan(true);
      if (prayerLabel) {
        setActivePrayerAlert(prayerLabel);
      }
    } catch {
      setIsPlayingAdhan(false);
      setAudioError('تکایە دوگمەی پێکردنی بانگ دابگرە بۆ گوێگرتن');
    }
  };

  const stopAdhanAudio = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsPlayingAdhan(false);
    setActivePrayerAlert(null);
    if (Capacitor.isNativePlatform()) {
      void BangAlarm.stopAdhan().catch(() => {});
    }
  };

  const triggerVibration = (pattern: number | number[]) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  };

  const showPrayerNotification = async (prayerLabel: string, mode: AlertMode) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const title = `کاتی بانگی ${prayerLabel} — ${CITY_NAME}`;
    const body = mode === 'adhan' ? 'بانگی نوێژ هات' : 'ئاگادارکردنەوەی هەزە';
    const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: `bang-${prayerLabel}`,
      renotify: true,
      requireInteraction: true,
      vibrate: [500, 250, 500, 250, 500],
    };

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.showNotification(title, options);
          return;
        }
      }
      new Notification(title, options);
    } catch {
      // Notification blocked by browser context
    }
  };

  // Register Lock Screen MediaSession metadata when Adhan plays
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!isPlayingAdhan) {
      navigator.mediaSession.playbackState = 'none';
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: activePrayerAlert ? `کاتی بانگی ${activePrayerAlert}` : 'Bang — کاتێن بانگی',
      artist: CITY_NAME,
      album: 'Bang',
      artwork: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
    navigator.mediaSession.playbackState = 'playing';
    navigator.mediaSession.setActionHandler('pause', stopAdhanAudio);
    navigator.mediaSession.setActionHandler('stop', stopAdhanAudio);
  }, [isPlayingAdhan, activePrayerAlert]);

  // Re-sync clock immediately when screen wakes up / tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setNow(new Date());
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, []);

  // Trigger Adhan or Vibration automatically when clock is within the prayer's minute
  useEffect(() => {
    const nowSeconds = timeParts.hour24 * 3600 + timeParts.minute * 60 + timeParts.second;
    const matchingPrayer = PRAYER_SCHEDULE.find((p) => {
      const targetSeconds = p.hour24 * 3600 + p.minute * 60;
      return nowSeconds >= targetSeconds && nowSeconds < targetSeconds + 60;
    });
    if (!matchingPrayer) return;

    const triggerKey = `${timeParts.gregorianDate}-${matchingPrayer.id}`;
    if (lastTriggeredRef.current === triggerKey) return;
    lastTriggeredRef.current = triggerKey;

    const mode = alertModes[matchingPrayer.id] ?? 'adhan';
    void showPrayerNotification(matchingPrayer.label, mode);
    if (mode === 'adhan') {
      void playAdhanAudio(matchingPrayer.label);
    } else {
      triggerVibration([500, 250, 500, 250, 500]);
      setActivePrayerAlert(matchingPrayer.label);
    }
  }, [timeParts.hour24, timeParts.minute, timeParts.second, timeParts.gregorianDate, alertModes]);

  const togglePrayerMode = (prayerId: string) => {
    setAlertModes((prev) => {
      const nextMode: AlertMode = prev[prayerId] === 'adhan' ? 'vibrate' : 'adhan';
      if (nextMode === 'vibrate') {
        triggerVibration(120);
      }
      return {
        ...prev,
        [prayerId]: nextMode,
      };
    });
  };

  const setAllPrayerModes = (mode: AlertMode) => {
    const updated: Record<string, AlertMode> = {};
    for (const prayer of PRAYER_SCHEDULE) {
      updated[prayer.id] = mode;
    }
    setAlertModes(updated);
    if (mode === 'vibrate') {
      triggerVibration(120);
    }
  };

  const handleRequestGps = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsStatus('error');
      setGpsError('ئەم ئامێرە پشتگیری GPS ناکات');
      return;
    }
    setGpsStatus('loading');
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setGpsStatus('success');
      },
      () => {
        setGpsStatus('error');
        setGpsError('مۆڵەتی GPS نەدرا یان بەردەست نییە');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleShareApp = async () => {
    setShareFeedback(null);
    const shareUrl = window.location.href;
    const shareData = {
      title: 'Bang — کاتێن بانگی شێلادزێ',
      text: 'کاتێن بانگی شێلادزێ',
      url: shareUrl,
    };

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        setShareFeedback('ئەپەکە شێرکرا');
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareFeedback('لینکی ئەپ کۆپی کرا');
    } catch {
      setShareFeedback('نەتوانرا لینکەکە کۆپی بکرێت');
    }
  };

  const ensureNotificationPermissionAuto = () => {
    if (Capacitor.isNativePlatform()) {
      void BangAlarm.requestAlarmPermissions().catch(() => {});
      return;
    }
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => {});
    }
  };

  // Automatically request lock-screen notification permission on first user interaction
  useEffect(() => {
    const handleFirstInteraction = () => {
      ensureNotificationPermissionAuto();
    };
    window.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    return () => window.removeEventListener('pointerdown', handleFirstInteraction);
  }, []);

  const handleDownloadApp = () => {
    setInstallGuide(null);
    setMenuOpen(false);
    setShowDownloadModal(true);
  };

  const allAreAdhan = PRAYER_SCHEDULE.every((p) => alertModes[p.id] === 'adhan');
  const allAreVibrate = PRAYER_SCHEDULE.every((p) => alertModes[p.id] === 'vibrate');

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-[#060E24] text-[#F5F7FA] flex flex-col relative overflow-x-hidden"
    >
      {/* Hidden Adhan Audio Element */}
      <audio
        ref={audioRef}
        src={ADHAN_AUDIO_SRC}
        preload="auto"
        onEnded={() => {
          setIsPlayingAdhan(false);
          setActivePrayerAlert(null);
        }}
        onError={() => {
          setIsPlayingAdhan(false);
          setAudioError('کێشە لە بارکردنی دەنگی بانگ هەیە');
        }}
      />

      {/* Subtle celestial navy depth matching the Bang logo */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(24,52,115,0.42)_0%,_rgba(6,14,36,0.92)_62%,_#040919_100%)]"
      />

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 h-14 bg-[#081331]/90 backdrop-blur-md border-b border-[#E2BE74]/18">
        <div className="max-w-5xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between">
          {/* Right side in RTL: Hamburger Menu Trigger */}
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label="مینۆ"
            aria-expanded={menuOpen}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#F5F7FA]/90 hover:text-[#E2BE74] hover:bg-white/5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2BE74]"
          >
            <Menu className="w-6 h-6" strokeWidth={2} />
          </button>

          {/* Center: باژێر */}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="min-h-[44px] px-4 flex items-center justify-center text-base sm:text-lg font-semibold tracking-tight text-[#F5F7FA] hover:text-[#E2BE74] transition-colors duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2BE74] rounded-xl"
          >
            باژێر
          </button>

          {/* Left side in RTL: Brand Icon */}
          <div className="min-w-[44px] flex items-center justify-end">
            {!logoError ? (
              <img
                src="/assets/aistudio/bang-logo-less-rounded_01dca3d5.png"
                alt="Bang"
                referrerPolicy="no-referrer"
                onError={() => setLogoError(true)}
                className="w-8 h-8 rounded-lg object-cover border border-[#E2BE74]/35 shadow-sm"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-[#0D1C42] border border-[#E2BE74]/35 flex items-center justify-center text-[#E2BE74] text-xs font-bold">
                B
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 lg:py-12 flex flex-col justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 lg:gap-10 items-center">
          {/* Primary Time, Date & Countdown Focal Column */}
          <section className="lg:col-span-5 flex flex-col items-center text-center">
            {/* City Name: شێلادزێ */}
            <h1 className="text-3xl sm:text-4xl font-bold text-[#E2BE74] tracking-tight mb-2">
              {CITY_NAME}
            </h1>

            {/* Live Clock */}
            <div
              dir="ltr"
              className="font-clock text-5xl sm:text-6xl font-bold tracking-tight text-[#F8FAFC] leading-none my-2 select-none"
            >
              {timeParts.liveClock12}
            </div>

            {/* Gregorian Date & Weekday */}
            <div className="mt-3 flex items-center justify-center gap-3 text-lg sm:text-xl font-medium text-[#E8EEF8]">
              <span>{timeParts.weekdayKurdish}</span>
              <span dir="ltr" className="font-clock font-semibold tracking-tight">
                {timeParts.gregorianDate}
              </span>
            </div>

            {/* Hijri Date */}
            <p className="mt-2 text-lg sm:text-xl font-medium text-[#D5DFEE]">
              {timeParts.hijriDate}
            </p>

            {/* Next Prayer Countdown Progress Bar */}
            <div className="w-full max-w-md mt-6">
              <div
                dir="ltr"
                role="progressbar"
                aria-valuenow={Math.round(nextInfo.progressPercent)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${nextInfo.nextPrayer.label} ${nextInfo.countdown}`}
                className="relative h-10 w-full rounded-full bg-[#D8E0EE] border border-[#E2BE74]/40 overflow-hidden shadow-inner"
              >
                {/* Warm Gold Progress Fill */}
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#C8963E] to-[#E6C37A] transition-all duration-500 ease-out"
                  style={{ width: `${nextInfo.progressPercent}%` }}
                />

                {/* Overlay Labels: Countdown centered, Next Prayer Name on right */}
                <div className="relative z-10 h-full px-5 flex items-center justify-between">
                  <span className="w-12" aria-hidden="true" />
                  <span className="font-clock text-sm sm:text-base font-bold text-[#060E24]">
                    {nextInfo.countdown}
                  </span>
                  <span
                    dir="rtl"
                    className="text-sm sm:text-base font-bold text-[#060E24] whitespace-nowrap"
                  >
                    {nextInfo.nextPrayer.label}
                  </span>
                </div>
              </div>
            </div>

            {/* Active Prayer Alert Banner (only shown when triggered) */}
            {activePrayerAlert && (
              <div className="w-full max-w-md mt-4 rounded-2xl bg-[#132656] border border-[#E2BE74]/50 px-4 py-3 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#F6DFAC]">
                  کاتی بانگی {activePrayerAlert}
                </span>
                <button
                  type="button"
                  onClick={stopAdhanAudio}
                  className="min-h-[40px] px-4 rounded-xl bg-[#E2BE74] text-[#060E24] text-xs font-bold hover:bg-[#EBD092] transition-colors whitespace-nowrap"
                >
                  وەستاندن
                </button>
              </div>
            )}
          </section>

          {/* Six Prayer Time Rows + Master Vibration/Adhan Controls */}
          <section aria-label="کاتێن بانگی" className="lg:col-span-7 w-full max-w-md lg:max-w-none mx-auto">
            {/* Top Controls: Master Vibration or Adhan Toggle + Adhan Audio Preview */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div
                role="group"
                aria-label="هەڵبژاردنی هەزە یان بانگ بۆ هەموو کاتەکان"
                className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#0D1C42] border border-[#E2BE74]/20"
              >
                <button
                  type="button"
                  onClick={() => setAllPrayerModes('adhan')}
                  className={`min-h-[40px] px-3.5 rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
                    allAreAdhan
                      ? 'bg-[#E2BE74] text-[#060E24]'
                      : 'text-[#D5DFEE] hover:text-[#F5F7FA] hover:bg-white/5'
                  }`}
                >
                  <Volume2 className="w-4 h-4 shrink-0" />
                  <span>بانگ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAllPrayerModes('vibrate')}
                  className={`min-h-[40px] px-3.5 rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
                    allAreVibrate
                      ? 'bg-[#E2BE74] text-[#060E24]'
                      : 'text-[#D5DFEE] hover:text-[#F5F7FA] hover:bg-white/5'
                  }`}
                >
                  <Vibrate className="w-4 h-4 shrink-0" />
                  <span>هەزە</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => (isPlayingAdhan ? stopAdhanAudio() : void playAdhanAudio())}
                className={`min-h-[44px] px-4 rounded-xl border text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
                  isPlayingAdhan
                    ? 'bg-[#E2BE74] border-[#E2BE74] text-[#060E24]'
                    : 'bg-[#0E1E46] border-[#E2BE74]/25 text-[#F6DFAC] hover:bg-[#14295E]'
                }`}
              >
                {isPlayingAdhan ? (
                  <>
                    <Square className="w-4 h-4 fill-current shrink-0" />
                    <span>وەستاندنی بانگ</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current shrink-0" />
                    <span>گوێگرتن لە بانگ</span>
                  </>
                )}
              </button>
            </div>

            {audioError && (
              <p className="mb-2 text-xs text-[#F6DFAC] text-right">{audioError}</p>
            )}

            {/* Prayer Schedule Rows */}
            <div className="flex flex-col gap-3">
              {PRAYER_SCHEDULE.map((prayer) => {
                const isNext = prayer.id === nextInfo.nextPrayer.id;
                const mode = alertModes[prayer.id] ?? 'adhan';

                return (
                  <div
                    key={prayer.id}
                    className={`grid grid-cols-12 gap-2.5 sm:gap-3 items-stretch transition-transform duration-150 ${
                      isNext ? 'scale-[1.01]' : ''
                    }`}
                  >
                    {/* Prayer Name Cell (Right side in RTL) */}
                    <div
                      className={`col-span-5 min-h-[54px] sm:min-h-[58px] rounded-2xl px-4 flex items-center justify-center border transition-colors duration-150 ${
                        isNext
                          ? 'bg-[#172E66] border-[#E2BE74]/60 shadow-[0_8px_24px_-8px_rgba(226,190,116,0.28)]'
                          : 'bg-[#0E1E46] border-[#E2BE74]/14 hover:bg-[#132656]'
                      }`}
                    >
                      <span
                        className={`text-lg sm:text-2xl font-semibold tracking-tight whitespace-nowrap ${
                          isNext ? 'text-[#F6DFAC]' : 'text-[#F5F7FA]'
                        }`}
                      >
                        {prayer.label}
                      </span>
                    </div>

                    {/* Prayer Time Cell */}
                    <div
                      dir="ltr"
                      className={`col-span-4 min-h-[54px] sm:min-h-[58px] rounded-2xl px-3 flex items-center justify-center border transition-colors duration-150 ${
                        isNext
                          ? 'bg-[#122554] border-[#E2BE74]/60 shadow-[0_8px_24px_-8px_rgba(226,190,116,0.22)]'
                          : 'bg-[#091534] border-[#E2BE74]/14 hover:bg-[#0E1D45]'
                      }`}
                    >
                      <span
                        className={`font-clock text-lg sm:text-2xl font-bold tracking-tight ${
                          isNext ? 'text-[#E2BE74]' : 'text-[#F5F7FA]'
                        }`}
                      >
                        {prayer.displayTime}
                      </span>
                    </div>

                    {/* Per-Prayer Mode Button: بانگ (Adhan) or هەزە (Vibration) */}
                    <button
                      type="button"
                      onClick={() => togglePrayerMode(prayer.id)}
                      aria-label={`${prayer.label}: ${mode === 'adhan' ? 'بانگ' : 'هەزە'}`}
                      className={`col-span-3 min-h-[54px] sm:min-h-[58px] rounded-2xl px-2 flex items-center justify-center gap-1.5 border text-xs sm:text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2BE74] ${
                        mode === 'adhan'
                          ? 'bg-[#10234F] border-[#E2BE74]/35 text-[#F6DFAC] hover:bg-[#163069]'
                          : 'bg-[#0B183B] border-[#9FB0CC]/25 text-[#D5DFEE] hover:bg-[#122452]'
                      }`}
                    >
                      {mode === 'adhan' ? (
                        <>
                          <Volume2 className="w-4 h-4 text-[#E2BE74] shrink-0" />
                          <span className="whitespace-nowrap">بانگ</span>
                        </>
                      ) : (
                        <>
                          <Vibrate className="w-4 h-4 text-[#9FB0CC] shrink-0" />
                          <span className="whitespace-nowrap">هەزە</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Bottom Action: داگرتنا APK Button */}
            {!hideApkButton && (
              <div className="mt-5 flex justify-start">
                <button
                  type="button"
                  onClick={handleDownloadApp}
                  className="min-h-[46px] px-5 rounded-2xl bg-[#E2BE74] hover:bg-[#EBD092] text-[#060E24] text-sm sm:text-base font-bold inline-flex items-center gap-2.5 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6DFAC]"
                >
                  <Download className="w-5 h-5 shrink-0" />
                  <span>داگرتنا APK</span>
                </button>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Slide-over Navigation Drawer for Menu / مینوو */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-start"
          role="dialog"
          aria-modal="true"
          aria-label="مینۆ"
        >
          <div
            className="fixed inset-0 bg-[#030712]/70 backdrop-blur-sm transition-opacity"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative z-10 w-80 max-w-[85vw] h-full bg-[#091638] border-l border-[#E2BE74]/20 p-6 flex flex-col justify-between shadow-2xl overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-5 border-b border-[#E2BE74]/15">
                <div className="flex items-center gap-3">
                  {!logoError && (
                    <img
                      src="/assets/aistudio/bang-logo-less-rounded_01dca3d5.png"
                      alt="Bang"
                      referrerPolicy="no-referrer"
                      onError={() => setLogoError(true)}
                      className="w-10 h-10 rounded-xl border border-[#E2BE74]/35"
                    />
                  )}
                  <span className="text-lg font-bold text-[#F5F7FA]">Bang</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="گرتن"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#D5DFEE] hover:text-[#E2BE74] hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2BE74]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-6 space-y-3">
                {/* Active City Card */}
                <div className="rounded-2xl bg-[#0F204D] border border-[#E2BE74]/20 p-4">
                  <div className="text-xs text-[#9FB0CC] mb-1">باژێر</div>
                  <div className="text-lg font-semibold text-[#E2BE74]">{CITY_NAME}</div>
                </div>

                {/* GPS Location Button in Menu */}
                <div className="rounded-2xl bg-[#0F204D] border border-[#E2BE74]/20 p-4 space-y-3">
                  <button
                    type="button"
                    onClick={handleRequestGps}
                    disabled={gpsStatus === 'loading'}
                    className="w-full min-h-[44px] px-4 rounded-xl bg-[#162C66] hover:bg-[#1C3880] disabled:opacity-60 border border-[#E2BE74]/35 text-[#F5F7FA] text-sm font-semibold flex items-center justify-between gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2BE74]"
                  >
                    <span className="flex items-center gap-2.5">
                      <LocateFixed className="w-5 h-5 text-[#E2BE74] shrink-0" />
                      <span>
                        {gpsStatus === 'loading' ? 'دیاریکردنی شوێن...' : 'GPS — شوێنی جوگرافی'}
                      </span>
                    </span>
                  </button>

                  {gpsStatus === 'success' && gpsCoords && (
                    <div
                      dir="ltr"
                      className="font-clock text-xs text-[#D5DFEE] bg-[#091534] border border-[#E2BE74]/15 rounded-xl px-3 py-2 text-center"
                    >
                      {gpsCoords.lat.toFixed(4)}, {gpsCoords.lng.toFixed(4)}
                    </div>
                  )}

                  {gpsStatus === 'error' && gpsError && (
                    <p className="text-xs text-[#F6DFAC]">{gpsError}</p>
                  )}
                </div>

                {/* Telegram Link with Icon */}
                <a
                  href={TELEGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[48px] px-4 py-3 rounded-2xl bg-[#0F204D] hover:bg-[#162C66] border border-[#E2BE74]/20 text-[#F5F7FA] text-sm font-semibold flex items-center justify-between gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2BE74]"
                >
                  <span className="flex items-center gap-2.5">
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className="w-5 h-5 text-[#E2BE74] fill-current shrink-0"
                    >
                      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
                    </svg>
                    <span>تیلێگرام</span>
                  </span>
                  <span dir="ltr" className="text-xs text-[#9FB0CC] font-clock truncate">
                    t.me/osamanzeermustafa
                  </span>
                </a>

                {/* Share App Button */}
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => void handleShareApp()}
                    className="w-full min-h-[48px] px-4 py-3 rounded-2xl bg-[#0F204D] hover:bg-[#162C66] border border-[#E2BE74]/20 text-[#F5F7FA] text-sm font-semibold flex items-center gap-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2BE74]"
                  >
                    <Share2 className="w-5 h-5 text-[#E2BE74] shrink-0" />
                    <span>شێرکردنی ئەپ</span>
                  </button>
                  {shareFeedback && (
                    <p className="text-xs text-[#E2BE74] px-2">{shareFeedback}</p>
                  )}
                </div>

                {/* Download / Install App Button */}
                {!hideApkButton && (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={handleDownloadApp}
                      className="w-full min-h-[48px] px-4 py-3 rounded-2xl bg-[#E2BE74] hover:bg-[#EBD092] text-[#060E24] text-sm font-bold flex items-center justify-center gap-2.5 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6DFAC]"
                    >
                      <Download className="w-5 h-5 shrink-0" />
                      <span>داگرتنا APK</span>
                    </button>
                    {installGuide && (
                      <p className="text-xs text-[#E2BE74] px-2">{installGuide}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="mt-6 w-full min-h-[44px] rounded-xl bg-[#13275C] hover:bg-[#193377] border border-[#E2BE74]/25 text-sm font-medium text-[#F5F7FA] transition-colors"
            >
              گرتن
            </button>
          </aside>
        </div>
      )}

      {/* Centered On-Screen APK Modal */}
      {showDownloadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="داگرتنا APK"
        >
          <div
            className="fixed inset-0 bg-[#030712]/75 backdrop-blur-sm"
            onClick={() => setShowDownloadModal(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-3xl bg-[#091638] border border-[#E2BE74]/30 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {!logoError && (
                  <img
                    src="/assets/aistudio/bang-logo-less-rounded_01dca3d5.png"
                    alt="Bang"
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-xl border border-[#E2BE74]/35"
                  />
                )}
                <div>
                  <h2 className="text-base font-bold text-[#F5F7FA]">داگرتنا APK — Bang</h2>
                  <p className="text-xs text-[#9FB0CC]">{CITY_NAME}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDownloadModal(false)}
                aria-label="گرتن"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#D5DFEE] hover:text-[#E2BE74] hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-[#0F204D] border border-[#E2BE74]/20 p-4 text-sm text-[#D5DFEE] space-y-2.5 leading-relaxed">
              <p className="font-semibold text-[#E2BE74]">
                دروستکردنی فایلی ڕاستەقینەی APK:
              </p>
              <p>
                ١. فایلی پڕۆژە (.zip) لێرەوە دابەزێنە و Extractـی بکە.
              </p>
              <p>
                ٢. فایلەکان بخە ناو هەژماری GitHub (لەگەڵ .github و android).
              </p>
              <p>
                ٣. لە GitHub بڕۆ تابی Actions ➔ Build Android APK و فایلی Bang-Shiladze-APK وەک .apk دابەزێنە.
              </p>
            </div>

            <a
              href="/api/download-project-zip"
              download="bang-shiladze-project.zip"
              className="w-full min-h-[48px] px-4 rounded-2xl bg-[#E2BE74] hover:bg-[#EBD092] text-[#060E24] text-sm font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-5 h-5 shrink-0" />
              <span>داگرتنا فایلی پڕۆژە (.zip)</span>
            </a>

            <button
              type="button"
              onClick={() => setShowDownloadModal(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#13275C] hover:bg-[#193377] border border-[#E2BE74]/25 text-sm font-medium text-[#F5F7FA] transition-colors"
            >
              گرتن
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
