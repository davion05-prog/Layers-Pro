import { AccountScreen } from "../../components/account-screen";
import { configured } from "../../lib/server";

export const metadata = { title: "Create an account | Layers Pro" };

export default function SignUpPage() {
  return <AccountScreen mode="signup" configured={configured()} />;
}
