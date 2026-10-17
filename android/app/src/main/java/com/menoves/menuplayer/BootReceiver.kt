package com.menoves.menuplayer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Start the player when the Fire Stick powers on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
