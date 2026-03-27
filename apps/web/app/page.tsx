import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";

export default async function HomePage() {
  const state = await readAppState();

  if (!state.initialized) {
    redirect("/setup");
  }

  const user = await getAuthenticatedUser();
  redirect(user ? "/dashboard" : "/login");
}
