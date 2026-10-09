import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { effectiveRoles } from "@/lib/admin-access";
import { canAccessBattle } from "@/lib/battle-access";
import { BattleTestingNotice } from "./BattleTestingNotice";
import { StudentFooter } from "@/components/layout/StudentFooter";

// Staged rollout: P2P Battle is open to SMO/ANUSMO/Admin only while it's being
// tested on prod. Everyone else gets an "in testing" notice instead of a
// silent redirect — a shared room/join link should read as "not yet", not as
// broken. API routes under /api/battle are the real data gate regardless.
export default async function BattleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const roles = effectiveRoles(session.user.role, session.user.roles);
  if (!canAccessBattle(roles)) {
    return (
      <>
        <BattleTestingNotice />
        <StudentFooter />
      </>
    );
  }

  return (
    <>
      {children}
      <StudentFooter />
    </>
  );
}
