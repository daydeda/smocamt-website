import { describe, expect, it } from "vitest";
import {
  EMPTY_MEMORY,
  INSTALL_PREVIEWS,
  SNOOZE_LATER_MS,
  SNOOZE_NEVER_MS,
  isInAppBrowser,
  isSnoozed,
  offersDontAsk,
  parseInstallPreview,
  parseMemory,
  pickInstallScreen,
  recordShown,
  snooze,
  type InstallPromptInput,
} from "./install-prompt";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_LINE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.3.0";
const IPHONE_FACEBOOK =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

function input(overrides: Partial<InstallPromptInput>): InstallPromptInput {
  return {
    userAgent: ANDROID_CHROME,
    standalone: false,
    pushSupported: true,
    permission: "default",
    hasSubscription: false,
    canInstall: false,
    ...overrides,
  };
}

describe("isInAppBrowser", () => {
  it("detects LINE and Facebook webviews", () => {
    expect(isInAppBrowser(IPHONE_LINE)).toBe(true);
    expect(isInAppBrowser(IPHONE_FACEBOOK)).toBe(true);
  });

  it("does not flag Safari or Chrome", () => {
    expect(isInAppBrowser(IPHONE_SAFARI)).toBe(false);
    expect(isInAppBrowser(ANDROID_CHROME)).toBe(false);
    expect(isInAppBrowser(DESKTOP_CHROME)).toBe(false);
  });
});

describe("pickInstallScreen", () => {
  it("shows nothing once this device is subscribed", () => {
    expect(pickInstallScreen(input({ permission: "granted", hasSubscription: true }))).toBeNull();
    expect(pickInstallScreen(input({ userAgent: IPHONE_SAFARI, standalone: true, permission: "granted", hasSubscription: true }))).toBeNull();
  });

  it("asks a granted device with no subscription to turn push on again", () => {
    expect(pickInstallScreen(input({ permission: "granted" }))).toBe("enable-push");
  });

  it("walks an iPhone Safari tab through Add to Home Screen", () => {
    expect(pickInstallScreen(input({ userAgent: IPHONE_SAFARI, pushSupported: false }))).toBe("ios-install");
  });

  it("sends in-app browsers to the real browser first", () => {
    expect(pickInstallScreen(input({ userAgent: IPHONE_LINE, pushSupported: false }))).toBe("in-app-browser");
  });

  it("offers push inside the installed iPhone app", () => {
    expect(pickInstallScreen(input({ userAgent: IPHONE_SAFARI, standalone: true }))).toBe("enable-push");
  });

  it("stays quiet on an installed iPhone too old for Web Push", () => {
    expect(pickInstallScreen(input({ userAgent: IPHONE_SAFARI, standalone: true, pushSupported: false }))).toBeNull();
  });

  it("shows the help card when permission is blocked", () => {
    expect(pickInstallScreen(input({ permission: "denied" }))).toBe("denied");
    expect(pickInstallScreen(input({ userAgent: IPHONE_SAFARI, standalone: true, permission: "denied" }))).toBe("denied");
  });

  it("offers the install button only when the browser gave us one", () => {
    expect(pickInstallScreen(input({ canInstall: true }))).toBe("android-install");
    expect(pickInstallScreen(input({ canInstall: false }))).toBe("enable-push");
    expect(pickInstallScreen(input({ canInstall: true, standalone: true }))).toBe("enable-push");
  });

  it("stays quiet where push is unsupported", () => {
    expect(pickInstallScreen(input({ userAgent: DESKTOP_CHROME, pushSupported: false }))).toBeNull();
  });
});

describe("snooze memory", () => {
  const now = 1_700_000_000_000;

  it("parses missing or broken storage as empty", () => {
    expect(parseMemory(null)).toEqual(EMPTY_MEMORY);
    expect(parseMemory("not json")).toEqual(EMPTY_MEMORY);
    expect(parseMemory('{"shownCount":"x"}')).toEqual(EMPTY_MEMORY);
  });

  it("round-trips stored values", () => {
    expect(parseMemory(JSON.stringify({ shownCount: 2, snoozedUntil: now }))).toEqual({ shownCount: 2, snoozedUntil: now });
  });

  it("snoozes 3 days for Not now and 14 days for Don't ask again", () => {
    expect(snooze(EMPTY_MEMORY, now, "later").snoozedUntil).toBe(now + SNOOZE_LATER_MS);
    expect(snooze(EMPTY_MEMORY, now, "never").snoozedUntil).toBe(now + SNOOZE_NEVER_MS);
    const snoozed = snooze(EMPTY_MEMORY, now, "later");
    expect(isSnoozed(snoozed, now + SNOOZE_LATER_MS - 1)).toBe(true);
    expect(isSnoozed(snoozed, now + SNOOZE_LATER_MS)).toBe(false);
  });

  it("offers Don't ask again from the third showing", () => {
    let memory = EMPTY_MEMORY;
    memory = recordShown(memory);
    expect(offersDontAsk(memory)).toBe(false);
    memory = recordShown(memory);
    expect(offersDontAsk(memory)).toBe(false);
    memory = recordShown(memory);
    expect(offersDontAsk(memory)).toBe(true);
  });
});

describe("dev preview scenarios", () => {
  it("map each preview to the screen it is named after", () => {
    expect(pickInstallScreen(INSTALL_PREVIEWS["ios-safari"])).toBe("ios-install");
    expect(pickInstallScreen(INSTALL_PREVIEWS["ios-installed"])).toBe("enable-push");
    expect(pickInstallScreen(INSTALL_PREVIEWS["android-chrome"])).toBe("android-install");
    expect(pickInstallScreen(INSTALL_PREVIEWS["android-installed"])).toBe("enable-push");
    expect(pickInstallScreen(INSTALL_PREVIEWS["in-app"])).toBe("in-app-browser");
    expect(pickInstallScreen(INSTALL_PREVIEWS.denied)).toBe("denied");
    expect(pickInstallScreen(INSTALL_PREVIEWS.subscribed)).toBeNull();
  });

  it("ignores unknown or inherited names", () => {
    expect(parseInstallPreview("ios-safari")).toBe("ios-safari");
    expect(parseInstallPreview(null)).toBeNull();
    expect(parseInstallPreview("nope")).toBeNull();
    expect(parseInstallPreview("toString")).toBeNull();
  });
});

describe("tablets and desktop-style iPads", () => {
  it("walks an iPad that looks like a Mac through Add to Home Screen", () => {
    expect(pickInstallScreen(INSTALL_PREVIEWS["ipad-safari"])).toBe("ios-install");
    expect(pickInstallScreen(INSTALL_PREVIEWS["ipad-installed"])).toBe("enable-push");
  });

  it("treats a real Mac as a desktop that can enable push in the tab", () => {
    expect(pickInstallScreen(INSTALL_PREVIEWS["mac-safari"])).toBe("enable-push");
  });

  it("treats an Android tablet like an Android phone", () => {
    expect(pickInstallScreen(INSTALL_PREVIEWS["android-tablet"])).toBe("android-install");
    expect(pickInstallScreen({ ...INSTALL_PREVIEWS["android-tablet"], canInstall: false })).toBe("enable-push");
    expect(pickInstallScreen({ ...INSTALL_PREVIEWS["android-tablet"], standalone: true })).toBe("enable-push");
  });
});
