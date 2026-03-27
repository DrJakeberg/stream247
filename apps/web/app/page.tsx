import { redirect } from "next/navigation";
import { getAuthenticatedUserEmail } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";

export default async function HomePage() {
  const state = await readAppState();

  if (!state.initialized) {
    redirect("/setup");
  }

  const email = await getAuthenticatedUserEmail();
  redirect(email ? "/dashboard" : "/login");
}
