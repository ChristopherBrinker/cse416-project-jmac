import { redirect } from "next/navigation";

import DevSandbox from "@/components/dev-sandbox";
import { isAuthenticated } from "@/lib/auth-server";

export default async function Dashboard() {
  if (!(await isAuthenticated())) {
    redirect("/sign-in");
  }
  return <DevSandbox />;
}
