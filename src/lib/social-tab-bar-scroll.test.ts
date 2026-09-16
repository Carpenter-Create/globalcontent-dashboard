import { describe, expect, it } from "vitest";

import {
  SOCIAL_TAB_BAR_SCROLL_THRESHOLD,
  createSocialTabBarScrollTracker,
  nextSocialTabBarVisibility,
  stepSocialTabBarScroll,
} from "./social-tab-bar-scroll";

describe("nextSocialTabBarVisibility", () => {
  it("stays visible at rest and on small jitter", () => {
    expect(nextSocialTabBarVisibility("visible", 40, 0)).toBe("visible");
    expect(nextSocialTabBarVisibility("hidden", 40, 0)).toBe("visible");
    expect(
      nextSocialTabBarVisibility("visible", SOCIAL_TAB_BAR_SCROLL_THRESHOLD, 80),
    ).toBe("visible");
    expect(
      nextSocialTabBarVisibility("hidden", -SOCIAL_TAB_BAR_SCROLL_THRESHOLD, 80),
    ).toBe("hidden");
  });

  it("hides on scroll-down and shows on scroll-up", () => {
    expect(nextSocialTabBarVisibility("visible", 12, 48)).toBe("hidden");
    expect(nextSocialTabBarVisibility("hidden", -12, 24)).toBe("visible");
  });
});

describe("stepSocialTabBarScroll", () => {
  it("hides after accumulated small down-steps and shows after accumulated up-steps", () => {
    let tracker = createSocialTabBarScrollTracker(10);
    for (let y = 12; y <= 20; y += 2) {
      tracker = stepSocialTabBarScroll(tracker, y);
    }
    expect(tracker.state).toBe("hidden");
    expect(tracker.acc).toBeGreaterThan(SOCIAL_TAB_BAR_SCROLL_THRESHOLD);

    tracker = stepSocialTabBarScroll(tracker, 18);
    tracker = stepSocialTabBarScroll(tracker, 16);
    tracker = stepSocialTabBarScroll(tracker, 14);
    tracker = stepSocialTabBarScroll(tracker, 10);
    expect(tracker.state).toBe("visible");
  });

  it("clears leftover acc after top overscroll so bounce-back stays visible", () => {
    let tracker = createSocialTabBarScrollTracker(0);
    tracker = stepSocialTabBarScroll(tracker, -24);
    expect(tracker).toEqual({ lastY: 0, acc: 0, state: "visible" });
    tracker = stepSocialTabBarScroll(tracker, 2);
    expect(tracker.state).toBe("visible");
    expect(tracker.acc).toBe(2);
  });

  it("resets the accumulator when direction reverses", () => {
    let tracker = createSocialTabBarScrollTracker(20);
    tracker = stepSocialTabBarScroll(tracker, 24);
    tracker = stepSocialTabBarScroll(tracker, 28);
    expect(tracker.acc).toBe(8);
    expect(tracker.state).toBe("visible");
    tracker = stepSocialTabBarScroll(tracker, 26);
    expect(tracker.acc).toBe(-2);
    expect(tracker.state).toBe("visible");
  });
});
