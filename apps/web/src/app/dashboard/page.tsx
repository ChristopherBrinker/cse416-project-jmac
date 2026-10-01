import { redirect } from "next/navigation";

import DashboardContent from "@/components/dashboard/dashboard-content";
import { isAuthenticated } from "@/lib/auth-server";

export default async function Dashboard() {
  if (!(await isAuthenticated())) {
    redirect("/sign-in");
  }
  return <DashboardContent />;
}
