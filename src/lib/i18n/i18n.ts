import { en } from "./locales/en";
import { th } from "./locales/th";
import { mm } from "./locales/mm";
import { cn } from "./locales/cn";


export type Language = "en" | "th" | "mm" | "cn";

// EN and TH must be complete. MM and CN may lag: admin-only keys are
// deliberately EN/TH only, and LanguageContext falls back to EN per missing key.
export const translations = { en, th, mm, cn };

// Compile-time guard: fails `tsc`/`next build` if TH is missing any EN key.
// (MM/CN are intentionally not checked — see the note above `translations`.)
type AssertNoMissingKeys<T extends never> = T;
export type ThaiTranslationsComplete = AssertNoMissingKeys<
  Exclude<keyof typeof translations.en, keyof typeof translations.th>
>;
