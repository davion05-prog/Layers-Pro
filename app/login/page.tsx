import { AccountScreen } from "../../components/account-screen";
import { configured } from "../../lib/server";

export const metadata = { title: "Log in | Layers Pro" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmation?: string }>;
}) {
  const { confirmation } = await searchParams;
  return (
    <AccountScreen
      mode="login"
      configured={configured()}
      confirmation={confirmation}
    />
  );
}
