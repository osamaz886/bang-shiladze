package com.bang.shiladze;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class AdhanForegroundService extends Service {
    public static final String ACTION_STOP = "com.bang.shiladze.STOP_ADHAN";
    private static final String CHANNEL_ID = "bang_adhan_alarm_channel";
    private static final int NOTIFICATION_ID = 2026;

    private MediaPlayer mediaPlayer;
    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopAndCleanup();
            return START_NOT_STICKY;
        }

        String prayerLabel = intent != null ? intent.getStringExtra("prayerLabel") : "بانگ";
        String mode = intent != null ? intent.getStringExtra("mode") : "adhan";
        if (prayerLabel == null) prayerLabel = "بانگ";
        if (mode == null) mode = "adhan";

        acquireWakeLock();
        createNotificationChannel();
        Notification notification = buildNotification(prayerLabel, mode);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        if ("vibrate".equals(mode)) {
            triggerVibration();
            handler.postDelayed(this::stopAndCleanup, 3500);
        } else {
            startAdhanPlayback();
        }

        return START_NOT_STICKY;
    }

    private void acquireWakeLock() {
        releaseWakeLock();
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Bang::AdhanWakeLock");
            wakeLock.acquire(4 * 60 * 1000L);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
    }

    private void startAdhanPlayback() {
        stopMediaPlayer();
        try {
            mediaPlayer = MediaPlayer.create(this, R.raw.bang_adhan);
            if (mediaPlayer == null) {
                stopAndCleanup();
                return;
            }
            mediaPlayer.setAudioAttributes(
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build()
            );
            mediaPlayer.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
            mediaPlayer.setOnCompletionListener(mp -> stopAndCleanup());
            mediaPlayer.setOnErrorListener((mp, what, extra) -> {
                stopAndCleanup();
                return true;
            });
            mediaPlayer.start();
        } catch (Exception e) {
            stopAndCleanup();
        }
    }

    @SuppressWarnings("deprecation")
    private void triggerVibration() {
        long[] pattern = new long[]{0, 600, 250, 600, 250, 600};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            if (vm != null) {
                vm.getDefaultVibrator().vibrate(VibrationEffect.createWaveform(pattern, -1));
            }
        } else {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern, -1));
                } else {
                    v.vibrate(pattern, -1);
                }
            }
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "کاتێن بانگی",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("ئاگادارکردنەوەی کاتی بانگ و هەزە");
            channel.setSound(null, null);
            channel.enableVibration(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String prayerLabel, String mode) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openIntent, flags);

        Intent stopIntent = new Intent(this, AdhanForegroundService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(this, 1, stopIntent, flags);

        String title = "کاتی بانگی " + prayerLabel + " — شێلادزێ";
        String text = "vibrate".equals(mode) ? "ئاگادارکردنەوەی هەزە" : "دەنگی بانگ لێدەدرێت";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setContentIntent(contentIntent)
                .addAction(0, "وەستاندن", stopPendingIntent)
                .build();
    }

    private void stopMediaPlayer() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
                mediaPlayer.release();
            } catch (Exception ignored) {
            }
            mediaPlayer = null;
        }
    }

    private void stopAndCleanup() {
        handler.removeCallbacksAndMessages(null);
        stopMediaPlayer();
        releaseWakeLock();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        stopMediaPlayer();
        releaseWakeLock();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
