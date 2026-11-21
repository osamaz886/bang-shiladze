package com.bang.shiladze;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

public class AdhanAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int requestCode = intent.getIntExtra("requestCode", 1000);
        String prayerId = intent.getStringExtra("prayerId");
        String prayerLabel = intent.getStringExtra("prayerLabel");
        int hour24 = intent.getIntExtra("hour24", 12);
        int minute = intent.getIntExtra("minute", 0);
        String mode = intent.getStringExtra("mode");

        if (prayerId == null) prayerId = "dhuhr";
        if (prayerLabel == null) prayerLabel = "بانگ";
        if (mode == null) mode = "adhan";

        // Reschedule for tomorrow
        AdhanScheduler.scheduleSingleNextDay(context, requestCode, prayerId, prayerLabel, hour24, minute, mode);

        Intent serviceIntent = new Intent(context, AdhanForegroundService.class);
        serviceIntent.putExtra("prayerLabel", prayerLabel);
        serviceIntent.putExtra("mode", mode);
        ContextCompat.startForegroundService(context, serviceIntent);
    }
}
