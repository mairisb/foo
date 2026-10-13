import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { Login } from "@/components/login";

export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await auth.api.getSession({ headers: await headers() })) redirect("/");
  return <Login />;
}
