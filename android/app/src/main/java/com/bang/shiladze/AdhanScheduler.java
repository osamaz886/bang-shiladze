package com.bang.shiladze;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Calendar;
import java.util.TimeZone;

public class AdhanScheduler {
    private static final String PREFS_NAME = "bang_alarms_prefs";
    private static final String KEY_SCHEDULE = "prayer_schedule_json";
    private static final String TIMEZONE_ID = "Asia/Baghdad";

    private static final String DEFAULT_SCHEDULE_JSON = "["
            + "{\"id\":\"fajr\",\"label\":\"سپێدە\",\"hour24\":5,\"minute\":17,\"mode\":\"adhan\"},"
            + "{\"id\":\"sunrise\",\"label\":\"روژهەلات\",\"hour24\":6,\"minute\":49,\"mode\":\"adhan\"},"
            + "{\"id\":\"dhuhr\",\"label\":\"نیڤرو\",\"hour24\":12,\"minute\":0,\"mode\":\"adhan\"},"
            + "{\"id\":\"asr\",\"label\":\"ئیڤار\",\"hour24\":14,\"minute\":41,\"mode\":\"adhan\"},"
            + "{\"id\":\"maghrib\",\"label\":\"مەغرەب\",\"hour24\":16,\"minute\":59,\"mode\":\"adhan\"},"
            + "{\"id\":\"isha\",\"label\":\"عەیشا\",\"hour24\":18,\"minute\":20,\"mode\":\"adhan\"}"
            + "]";

    public static void saveAndScheduleAll(Context context, String jsonArrayStr) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_SCHEDULE, jsonArrayStr).apply();
        scheduleAll(context);
    }

    public static void scheduleAll(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String jsonStr = prefs.getString(KEY_SCHEDULE, DEFAULT_SCHEDULE_JSON);
        try {
            JSONArray array = new JSONArray(jsonStr);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                String id = item.getString("id");
                String label = item.getString("label");
                int hour24 = item.getInt("hour24");
                int minute = item.getInt("minute");
                String mode = item.optString("mode", "adhan");
                schedulePrayer(context, 1000 + i, id, label, hour24, minute, mode, false);
            }
        } catch (Exception ignored) {
        }
    }

    public static void scheduleSingleNextDay(Context context, int requestCode, String id, String label, int hour24, int minute, String mode) {
        schedulePrayer(context, requestCode, id, label, hour24, minute, mode, true);
    }

    private static void schedulePrayer(
            Context context,
            int requestCode,
            String id,
            String label,
            int hour24,
            int minute,
            String mode,
            boolean forceNextDay
    ) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        TimeZone tz = TimeZone.getTimeZone(TIMEZONE_ID);
        Calendar now = Calendar.getInstance(tz);
        Calendar target = Calendar.getInstance(tz);
        target.set(Calendar.HOUR_OF_DAY, hour24);
        target.set(Calendar.MINUTE, minute);
        target.set(Calendar.SECOND, 0);
        target.set(Calendar.MILLISECOND, 0);

        if (forceNextDay || target.getTimeInMillis() <= now.getTimeInMillis()) {
            target.add(Calendar.DAY_OF_YEAR, 1);
        }

        Intent intent = new Intent(context, AdhanAlarmReceiver.class);
        intent.putExtra("requestCode", requestCode);
        intent.putExtra("prayerId", id);
        intent.putExtra("prayerLabel", label);
        intent.putExtra("hour24", hour24);
        intent.putExtra("minute", minute);
        intent.putExtra("mode", mode);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, requestCode, intent, flags);

        long triggerAtMillis = target.getTimeInMillis();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Intent showIntent = new Intent(context, MainActivity.class);
            PendingIntent showPending = PendingIntent.getActivity(context, requestCode + 500, showIntent, flags);
            AlarmManager.AlarmClockInfo alarmClockInfo = new AlarmManager.AlarmClockInfo(triggerAtMillis, showPending);
            alarmManager.setAlarmClock(alarmClockInfo, pendingIntent);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent);
        } else {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent);
        }
    }
}
