import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canAwardPrizes, canManagePrizes, effectiveRoles } from "@/lib/admin-access";
import PrizesClient from "./PrizesClient";

export const dynamic = "force-dynamic";

// Defense-in-depth on top of the proxy and each API's own gate: this only
// decides whether the page renders. Every API below resolves the authoritative,
// DB-backed scope independently (src/lib/prize-scope.ts).
//
// Note the two different capabilities: awarding (includes smo — the prize table
// is staffed like the scanner) and managing/exporting (excludes smo — the dean
// report is every winner's name, รหัสนักศึกษา and face photo in one forwardable
// file). See docs/features/prize-claim.md.
export default async function AdminPrizesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles = effectiveRoles(session.user.role, session.user.roles);
  const canAward = canAwardPrizes(roles);
  const canManage = canManagePrizes(roles);
  if (!canAward && !canManage) redirect("/admin/dashboard");

  // Deleting a prize cascades its claims + proof photos — the ONLY way any of
  // that data goes away. super_admin only; the route (DELETE
  // /api/admin/prizes/[id]) is the real gate, this just decides whether the
  // button renders.
  const isSuperAdmin = roles.includes("super_admin");

  return <PrizesClient canAward={canAward} canManage={canManage} isSuperAdmin={isSuperAdmin} />;
}
