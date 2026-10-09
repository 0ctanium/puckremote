import { ReactNode, Suspense } from "react";
import { User } from "./sidebar";
import "@puckeditor/core/puck.css";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <nav className="admin-nav">
          <a href="/">Dashboard</a>
          <a href="/editor">Editor</a>
        </nav>
        <Suspense>
          <User />
        </Suspense>
      </aside>
      <main className="admin-content">{children}</main>
    </div>
  );
}
