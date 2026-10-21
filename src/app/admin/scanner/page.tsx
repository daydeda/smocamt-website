import ScannerScreen from "./ScannerScreen";

// The screen itself lives in ScannerScreen.tsx so /dashboard/scan can embed the
// same check-in flow. A Next page may only export the page component, which is
// why this is a thin wrapper rather than the screen.
export default function QRScannerPage() {
  return <ScannerScreen />;
}
