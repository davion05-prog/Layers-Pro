import Workspace from "../components/workspace";
import { dayNow } from "../lib/model";

export default function Page() { return <Workspace initialDay={dayNow()} />; }
