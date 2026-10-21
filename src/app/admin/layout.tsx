import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { User } from "lucide-react";
import { AdminNav } from "@/components/admin/AdminNav";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { AdminLayoutWrapper } from "@/components/admin/AdminLayoutWrapper";
import { canEnterAdminAny, effectiveRoles } from "@/lib/access/admin-access";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  if (!session?.user) {
    redirect("/dashboard");
  }

  // Scanner-only roles (smo, club/major president) can enter the admin area, but
  // AdminNav shows just the Scanner and the sensitive APIs still reject them. Gate on
  // the whole role SET (effectiveRoles, shared with the proxy + entry points) so a
  // user whose admin-granting role isn't their primary one isn't wrongly locked out.
  const roles = effectiveRoles(session.user.role, session.user.roles);
  if (!canEnterAdminAny(roles, session.user.hasStaffPosition)) {
    redirect("/dashboard");
  }

  return (
    <AdminLayoutWrapper user={session.user}>
      {children}
    </AdminLayoutWrapper>
  );
}