package com.bang.shiladze;

import android.Manifest;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BangAlarm")
public class BangAlarmPlugin extends Plugin {

    @PluginMethod
    public void syncAlarms(PluginCall call) {
        String scheduleJson = call.getString("scheduleJson");
        if (scheduleJson == null || scheduleJson.isEmpty()) {
            call.reject("Missing scheduleJson");
            return;
        }
        AdhanScheduler.saveAndScheduleAll(getContext(), scheduleJson);
        JSObject result = new JSObject();
        result.put("scheduled", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopAdhan(PluginCall call) {
        Intent stopIntent = new Intent(getContext(), AdhanForegroundService.class);
        stopIntent.setAction(AdhanForegroundService.ACTION_STOP);
        getContext().startService(stopIntent);
        call.resolve();
    }

    @PluginMethod
    public void requestAlarmPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED && getActivity() != null) {
                ActivityCompat.requestPermissions(
                        getActivity(),
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        101
                );
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            if (am != null && !am.canScheduleExactAlarms() && getActivity() != null) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
            }
        }
        call.resolve();
    }
}
