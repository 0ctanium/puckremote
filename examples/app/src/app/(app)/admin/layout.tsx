import { ReactNode } from "react";

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <aside></aside>
      <main>{children}</main>
    </div>
  );
}
