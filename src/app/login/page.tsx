import { loginAuthErrorNotice } from "@/lib/app-states";

import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  return <LoginForm authError={loginAuthErrorNotice(error)} />;
}
