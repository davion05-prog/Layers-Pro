import { RecoveryScreen } from "../../components/recovery-screen";

export const metadata = { title: "Reset your password | Layers Pro" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  return (
    <RecoveryScreen
      update={false}
      expired={(await searchParams).expired === "1"}
    />
  );
}
