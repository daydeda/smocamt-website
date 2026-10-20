import type { Metadata } from "next";
import PrivacyClient from "./PrivacyClient";

export const metadata: Metadata = {
  title: "Privacy Policy — ActiveCAMT",
  description:
    "How ActiveCAMT collects, uses, stores and backs up personal data. | นโยบายความเป็นส่วนตัวของ ActiveCAMT",
};

export default function PrivacyPage() {
  return <PrivacyClient />;
}
