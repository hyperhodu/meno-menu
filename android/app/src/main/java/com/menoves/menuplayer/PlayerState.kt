package com.menoves.menuplayer

/** Shared flag between the player screen and the accessibility service. */
object PlayerState {
    /** True while the player is showing content: remote buttons are ignored. False on the setup screen. */
    @Volatile var locked = true
}
