import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { safeCallbackPath } from "@/lib/util/safe-callback-url";
import { LandingUI } from "@/components/home/LandingUI";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  let session = null;
  try {
    session = await auth();
  } catch (err) {
    console.error("Auth failed during login page load:", err);
  }

  const { error, callbackUrl } = await searchParams;
  // Where to send the visitor after sign-in (same-site paths only).
  const returnTo = safeCallbackPath(callbackUrl);

  // Already authenticated: go back where they came from (or the dashboard) if the
  // profile is complete, onboarding if not.
  if (session?.user) {
    const user = session.user;
    if (user.profileCompleted) {
      redirect(returnTo ?? "/dashboard");
    } else {
      redirect("/onboarding");
    }
  }

  // Auth.js redirects failed OAuth callbacks here with ?error=... (e.g.
  // "Configuration" for an InvalidCheck/PKCE cookie failure — typically an
  // expired sign-in or an in-app browser that dropped the cookie). Surface a
  // friendly, actionable banner instead of silently showing the landing page.
  return <LandingUI userCount={31} authError={error ?? null} callbackUrl={returnTo} enableDevLogin={process.env.ENABLE_DEV_LOGIN === "true"} />;
}
