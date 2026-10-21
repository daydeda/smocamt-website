import { auth } from "@/auth";
import { canManagePropertyTags, effectiveRoles } from "@/lib/access/admin-access";

// Server-side gate for every /api/admin/property-tags route and the admin
// pages. The proxy and AdminNav only decide what is visible; this is what
// actually protects the data. One flat capability (PROPERTY_TAG_ROLES): no
// per-group scoping.
export async function resolvePropertyTagStaff(): Promise<{ userId: string; roles: string[] } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const roles = effectiveRoles(session.user.role, session.user.roles);
  if (!canManagePropertyTags(roles)) return null;
  return { userId: session.user.id, roles };
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
