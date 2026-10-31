import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useEffect, useState } from 'react';
import { FRAME_INTERVAL_MS } from '../constants.js';
import { noteFrameCause } from '../geometry-trace.js';
import { useTerminalFocus } from '../hooks/use-terminal-focus.js';
import { callWithUpdateOverflowGuard, registerOverflowQuench } from '../update-overflow-guard.js';
export function createClock(tickIntervalMs) {
    const subscribers = new Map();
    let interval = null;
    let currentTickIntervalMs = tickIntervalMs;
    let startTime = 0;
    // Snapshot of the current tick's time, ensuring all subscribers in the same
    // tick see the same value (keeps animations synchronized)
    let tickTime = 0;
    function tick() {
        tickTime = Date.now() - startTime;
        noteFrameCause('animation');
        for (const onChange of subscribers.keys()) {
            // #185 self-heal: a thrown overflow resets React's nested-update
            // counter, so absorbing it here drops at most one animation frame.
            callWithUpdateOverflowGuard('clock.tick', onChange);
        }
    }
    function updateInterval() {
        const anyKeepAlive = [...subscribers.values()].some(Boolean);
        if (anyKeepAlive) {
            if (interval) {
                clearInterval(interval);
                interval = null;
            }
            if (startTime === 0) {
                startTime = Date.now();
            }
            interval = setInterval(tick, currentTickIntervalMs);
        }
        else if (interval) {
            clearInterval(interval);
            interval = null;
        }
    }
    function suspendFor(ms) {
        if (interval) {
            clearInterval(interval);
            interval = null;
        }
        // Resume after the backoff window. unref: a paused clock must never
        // hold the process open by itself.
        const resume = setTimeout(() => {
            updateInterval();
        }, ms);
        resume.unref?.();
    }
    const clock = {
        subscribe(onChange, keepAlive) {
            subscribers.set(onChange, keepAlive);
            updateInterval();
            return () => {
                subscribers.delete(onChange);
                updateInterval();
            };
        },
        now() {
            if (startTime === 0) {
                startTime = Date.now();
            }
            // When the clock interval is running, return the synchronized tickTime
            // so all subscribers in the same tick see the same value.
            // When paused (no keepAlive subscribers), return real-time to avoid
            // returning a stale tickTime from the last tick before the pause.
            if (interval && tickTime) {
                return tickTime;
            }
            return Date.now() - startTime;
        },
        setTickInterval(ms) {
            if (ms === currentTickIntervalMs)
                return;
            currentTickIntervalMs = ms;
            updateInterval();
        },
        suspend: suspendFor
    };
    // Circuit-breaker quench: a sustained #185 oscillation at this tick
    // pauses the shared clock instead of being absorbed forever (which would
    // leave the process alive but burning CPU on the oscillation's commits).
    registerOverflowQuench('clock.tick', ms => clock.suspend(ms));
    return clock;
}
export const ClockContext = createContext(null);
const BLURRED_TICK_INTERVAL_MS = FRAME_INTERVAL_MS * 2;
/** Stable clock ownership; focus only changes its scheduling interval. */
export function ClockProvider({ children }) {
    const [clock] = useState(() => createClock(FRAME_INTERVAL_MS));
    const focused = useTerminalFocus();
    useEffect(() => {
        clock.setTickInterval(focused ? FRAME_INTERVAL_MS : BLURRED_TICK_INTERVAL_MS);
    }, [clock, focused]);
    return _jsx(ClockContext.Provider, { value: clock, children: children });
}
