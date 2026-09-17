import { describe, it, expect } from "vitest";
import { isIOSUserAgent, isPushPermissionRequestable } from "./pwa-standalone";

describe("isIOSUserAgent", () => {
  it("returns true for iPad user agents", () => {
    const iPad =
      "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
    expect(isIOSUserAgent(iPad)).toBe(true);
  });

  it("returns true for iPhone user agents", () => {
    const iPhone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
    expect(isIOSUserAgent(iPhone)).toBe(true);
  });

  it("returns true for iPod user agents", () => {
    const iPod =
      "Mozilla/5.0 (iPod touch; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
    expect(isIOSUserAgent(iPod)).toBe(true);
  });

  it("returns false for Android Chrome user agents", () => {
    const androidChrome =
      "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    expect(isIOSUserAgent(androidChrome)).toBe(false);
  });

  it("returns false for desktop Chrome user agents", () => {
    const desktopChrome =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(isIOSUserAgent(desktopChrome)).toBe(false);
  });

  it("returns false for desktop Safari user agents", () => {
    const desktopSafari =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15";
    expect(isIOSUserAgent(desktopSafari)).toBe(false);
  });

  it("returns false for Firefox user agents", () => {
    const firefox =
      "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
    expect(isIOSUserAgent(firefox)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isIOSUserAgent("")).toBe(false);
  });

  it("returns false for generic user agent without iOS identifiers", () => {
    expect(isIOSUserAgent("Mozilla/5.0 (Unknown; U) Gecko/20100101 Firefox/1.0")).toBe(false);
  });

  it("is case-sensitive for iPad/iPhone/iPod detection", () => {
    expect(isIOSUserAgent("ipad")).toBe(false);
    expect(isIOSUserAgent("iphone")).toBe(false);
    expect(isIOSUserAgent("ipod")).toBe(false);
  });
});

describe("isPushPermissionRequestable", () => {
  it("returns true for non-iOS user agent regardless of standalone value", () => {
    const androidChrome =
      "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    expect(isPushPermissionRequestable(androidChrome, true)).toBe(true);
    expect(isPushPermissionRequestable(androidChrome, false)).toBe(true);
  });

  it("returns true for desktop Chrome regardless of standalone value", () => {
    const desktopChrome =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(isPushPermissionRequestable(desktopChrome, true)).toBe(true);
    expect(isPushPermissionRequestable(desktopChrome, false)).toBe(true);
  });

  it("returns true for iOS user agent when standalone is true", () => {
    const iPhone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
    expect(isPushPermissionRequestable(iPhone, true)).toBe(true);
  });

  it("returns false for iOS user agent when standalone is false", () => {
    const iPhone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
    expect(isPushPermissionRequestable(iPhone, false)).toBe(false);
  });

  it("returns true for iPad when standalone is true", () => {
    const iPad =
      "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
    expect(isPushPermissionRequestable(iPad, true)).toBe(true);
  });

  it("returns false for iPad when standalone is false", () => {
    const iPad =
      "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
    expect(isPushPermissionRequestable(iPad, false)).toBe(false);
  });

  it("returns true for iPod when standalone is true", () => {
    const iPod =
      "Mozilla/5.0 (iPod touch; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
    expect(isPushPermissionRequestable(iPod, true)).toBe(true);
  });

  it("returns false for iPod when standalone is false", () => {
    const iPod =
      "Mozilla/5.0 (iPod touch; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
    expect(isPushPermissionRequestable(iPod, false)).toBe(false);
  });

  it("returns false for empty iOS user agent string when standalone is false", () => {
    expect(isPushPermissionRequestable("", false)).toBe(true);
  });

  it("treats lowercase device names as non-iOS (not detected)", () => {
    const lowerCaseiPhone = "iphone";
    // "iphone" (lowercase) doesn't match the /iPad|iPhone|iPod/ regex,
    // so it's treated as a non-iOS user agent
    expect(isPushPermissionRequestable(lowerCaseiPhone, true)).toBe(true);
    expect(isPushPermissionRequestable(lowerCaseiPhone, false)).toBe(true);
  });
});
