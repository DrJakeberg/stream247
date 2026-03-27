import { redirect } from "next/navigation";
import { Panel } from "@/components/panel";
import { LoginForm } from "@/components/login-form";
import { getAuthenticatedUserEmail } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";

export default async function LoginPage() {
  const state = await readAppState();

  if (!state.initialized) {
    redirect("/setup");
  }

  const email = await getAuthenticatedUserEmail();

  if (email) {
    redirect("/dashboard");
  }

  return (
    <main className="standalone">
      <Panel title="Sign in" eyebrow="Owner access">
        <p className="subtle">Use the owner account created during first-run setup.</p>
        <LoginForm />
      </Panel>
    </main>
  );
}

