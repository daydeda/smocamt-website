import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { StudentFooter } from "@/components/layout/StudentFooter";

// Any signed-in user may play. API routes under /api/battle are the real data
// gate (auth + per-room participant checks).
export default async function BattleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <>
      {children}
      <StudentFooter />
    </>
  );
}
