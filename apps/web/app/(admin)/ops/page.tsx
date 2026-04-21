import { permanentRedirect } from "next/navigation";

export default function OpsPage() {
  permanentRedirect("/dashboard");
}
