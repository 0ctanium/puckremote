import { redirect } from "next/navigation";

// admin.example.com/ → the editor.
export default function AdminHome() {
  redirect("/editor");
}
