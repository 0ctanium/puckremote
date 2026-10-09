"use client";

import { Button } from "@puckeditor/core";
import { logout } from "./actions";

export function LogoutButton() {
  return (
    <form action={logout} style={{ marginTop: 8 }}>
      <Button type="submit" variant="secondary">
        Log out
      </Button>
    </form>
  );
}
