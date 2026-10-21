import { Html5QrcodeSupportedFormats, type Html5QrcodeCameraScanConfig, type Html5QrcodeFullConfig } from "html5-qrcode";

// Shared html5-qrcode config for every camera-based QR reader in the app (the
// admin scanner and the prize-claim booth panel). The two call sites had
// already drifted apart before this module existed — the prize panel used
// aspectRatio: 1 and the main scanner didn't, and NEITHER restricted which
// barcode formats get decoded — so this centralizes both configs in one place
// with the reasoning attached, instead of letting them diverge again.
//
// html5-qrcode splits config across TWO calls with different shapes (checked
// against the installed 2.3.8 types in node_modules/html5-qrcode/*.d.ts, not
// guessed): formatsToSupport/useBarCodeDetectorIfSupported/experimentalFeatures
// are CONSTRUCTOR-time options (`new Html5Qrcode(elementId, config)`); fps/
// qrbox/aspectRatio/disableFlip/videoConstraints are start()-time options
// (`scanner.start(cameraIdOrConfig, config, ...)`). Passing formatsToSupport
// to start() (as an earlier draft of this fix assumed) is silently ignored —
// it has no effect there.

// Constructor-time config.
export const QR_SCANNER_CONSTRUCTOR_CONFIG: Html5QrcodeFullConfig = {
  // Without this, the ZXing decoder (and the native BarcodeDetector below)
  // try every one of the library's 17 supported 1D/2D formats on every video
  // frame — QR is the only one this app ever issues, so restricting it is
  // pure wasted decode time removed from every frame that doesn't yet contain
  // a readable code, which is most frames during the "staff still aiming"
  // phase that actually feels slow.
  formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
  // Confirmed in the library source (getUseBarCodeDetectorIfSupported): this
  // is ALREADY the default when no config object is passed at all, so this
  // isn't a behavior change by itself. Set explicitly so the intent is
  // visible in this app's code rather than only in the library's default,
  // and so it can't silently regress if a future config addition here
  // accidentally overrides it. Where the browser exposes the native
  // BarcodeDetector API (Android Chrome), this swaps in a hardware-backed
  // decode instead of the JS/WASM one.
  useBarCodeDetectorIfSupported: true,
  verbose: false,
};

// start()-time config.
export const QR_SCANNER_START_CONFIG: Html5QrcodeCameraScanConfig = {
  fps: 20,
  // Responsive reticle: a fixed 280x280 box is a small, easy-to-miss fraction
  // of a modern phone's video frame, so the code has to be aimed unnecessarily
  // precisely. Size it off the actual viewfinder instead (library-enforced
  // floor is 50px, MIN_QR_BOX_SIZE — a viewfinder would have to be under
  // ~70px wide to ever hit that, which never happens in this UI).
  qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
    const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.75);
    return { width: edge, height: edge };
  },
  aspectRatio: 1,
  // A QR code on a phone screen or a printed ID is never mirrored. Per the
  // library source (foreverScan), the flipped re-decode only runs when the
  // FIRST (normal) pass fails to find a code — i.e. on most frames while
  // staff are still aiming — so skipping it removes real wasted work from
  // exactly the phase that feels slow. (A front-facing desktop webcam
  // fallback, used only for local testing, could in principle hand back an
  // already-mirrored stream on unusual hardware; that's a non-issue for the
  // phones staff actually scan with at a booth.)
  disableFlip: true,
  videoConstraints: {
    // Passing videoConstraints here makes html5-qrcode use THIS object
    // instead of the `{ facingMode: "environment" }` passed as start()'s
    // first argument (confirmed in the library source), so facingMode has to
    // be repeated here or the camera-selection preference is silently lost.
    facingMode: "environment",
    width: { ideal: 1280 },
    height: { ideal: 720 },
    // Continuous autofocus — a code held CLOSE (the reported complaint: "even
    // putting the scanner near the attendee's QR code") is exactly what a
    // fixed-focus stream blurs. `focusMode` isn't part of the TS DOM lib's
    // MediaTrackConstraintSet, so this is cast rather than typed inline; an
    // unsupported constraint key is ignored by getUserMedia, never fatal.
    advanced: [{ focusMode: "continuous" }] as unknown as MediaTrackConstraints["advanced"],
  },
};
