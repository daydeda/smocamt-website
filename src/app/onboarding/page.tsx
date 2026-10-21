import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isStaffBypassEmail } from "@/lib/access/staff-bypass";
import { UsersService } from "@/modules/users/users.service";
import OnboardingClient from "./OnboardingClient";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();

  // Protect route: if not authenticated, redirect to /login directly on the server
  if (!session?.user) {
    redirect("/login");
  }

  // If onboarding is already completed, redirect to dashboard
  const user = session.user;
  if (user.profileCompleted) {
    redirect("/dashboard");
  }

  // Staff bypass: listed accounts never fill in the onboarding form. Provision
  // them (nickname + staff role + balanced house) and send straight to the
  // dashboard. The jwt callback's eager-refresh-while-incomplete picks up the
  // freshly-set profileCompleted on that next request, so they don't bounce back.
  if (user.id && isStaffBypassEmail(user.email)) {
    await UsersService.provisionStaffBypass(user.id, user.email);
    redirect("/dashboard");
  }

  return <OnboardingClient initialSession={session} />;
}