import React from "react";

export function StatusBadgeOpen() {
  return (
    <>
      <span className="bg-positive animation-duration-[500ms] size-2 animate-pulse rounded-full" />
      <span>Connected</span>
    </>
  );
}
