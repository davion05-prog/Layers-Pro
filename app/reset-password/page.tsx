import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { RecoveryScreen } from "../../components/recovery-screen";
import { RESET_SESSION } from "../../lib/account-security";

export const metadata = { title: "Choose a new password | Layers Pro" };

export default async function ResetPasswordPage() {
  if (!(await cookies()).has(RESET_SESSION))
    redirect("/forgot-password?expired=1");
  return <RecoveryScreen update />;
}
