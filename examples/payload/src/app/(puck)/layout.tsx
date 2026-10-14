import type { ReactNode } from "react";

// Payload's admin has its own root layout ((payload)/layout.tsx): each route group has one.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
