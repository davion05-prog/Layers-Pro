import Workspace from "../../components/workspace";
import { dayNow } from "../../lib/model";

export const metadata = { title: "Demo | Layers Pro" };

export default function DemoPage() {
  return <Workspace initialDay={dayNow()} demo />;
}
