package com.menoves.menuplayer

/** Shared flags between the player screen and the accessibility service. */
object PlayerState {
    @Volatile var inForeground = false
    /** True while the player is showing content: remote buttons are ignored. False on the setup screen. */
    @Volatile var locked = true
    /** True after Home opened the network settings; Back or Home there returns to the player. */
    @Volatile var inNetworkSettings = false
}
