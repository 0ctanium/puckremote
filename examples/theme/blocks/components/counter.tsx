"use client";
import { useState } from "react";

/** An island: SSR'd in the sandbox, hydrated on public pages (see "use client" above). */
export function Counter({ start = 0 }: { start?: number }) {
  const [count, setCount] = useState(start);
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
}
