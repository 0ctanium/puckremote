"use server";
import { redirect } from "next/navigation";
import { checkCredentials, createSession, deleteSession } from "@/auth.ts";

export async function login(form: FormData) {
  const user = checkCredentials(String(form.get("username") ?? ""), String(form.get("password") ?? ""));
  if (!user) redirect("/login?error=1");
  await createSession(user);
  redirect("/editor");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
