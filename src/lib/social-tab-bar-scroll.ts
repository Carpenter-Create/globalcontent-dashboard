export const SOCIAL_TAB_BAR_SCROLL_THRESHOLD = 8;

export type SocialTabBarScrollState = "visible" | "hidden";

export type SocialTabBarScrollTracker = {
  lastY: number;
  acc: number;
  state: SocialTabBarScrollState;
};

export function createSocialTabBarScrollTracker(y = 0): SocialTabBarScrollTracker {
  return { lastY: y, acc: 0, state: "visible" };
}

// FB-style hide on scroll-down / show on scroll-up. Rest (y <= 0) stays visible.
export function nextSocialTabBarVisibility(
  current: SocialTabBarScrollState,
  deltaY: number,
  y: number,
  threshold = SOCIAL_TAB_BAR_SCROLL_THRESHOLD,
): SocialTabBarScrollState {
  if (y <= 0) return "visible";
  if (deltaY > threshold) return "hidden";
  if (deltaY < -threshold) return "visible";
  return current;
}

// Accumulate per-frame deltas so a slow finger-drag still crosses the threshold.
export function stepSocialTabBarScroll(
  tracker: SocialTabBarScrollTracker,
  y: number,
  threshold = SOCIAL_TAB_BAR_SCROLL_THRESHOLD,
): SocialTabBarScrollTracker {
  if (y <= 0) {
    return { lastY: 0, acc: 0, state: "visible" };
  }
  const delta = y - tracker.lastY;
  let acc = tracker.acc;
  if ((delta > 0 && acc < 0) || (delta < 0 && acc > 0)) acc = 0;
  acc += delta;
  return {
    lastY: y,
    acc,
    state: nextSocialTabBarVisibility(tracker.state, acc, y, threshold),
  };
}
