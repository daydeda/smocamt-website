import { StudentFooter } from "@/components/layout/StudentFooter";

// Shared shell for every /dashboard page: each page still renders its own
// StudentNav, but the credit/copyright footer is mounted once here.
export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <StudentFooter />
    </>
  );
}
