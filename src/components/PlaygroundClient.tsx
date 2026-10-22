"use client";

import dynamic from "next/dynamic";

// Client-only: the editor and localStorage-backed state have nothing to server-render.
const Playground = dynamic(() => import("./Playground"), { ssr: false });

export default function PlaygroundClient() {
  return <Playground />;
}
