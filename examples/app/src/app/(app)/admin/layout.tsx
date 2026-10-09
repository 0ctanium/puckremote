import { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <aside></aside>
      <main>{children}</main>
    </div>
  );
}
