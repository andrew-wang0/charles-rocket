import { ArrowsCounterClockwiseIcon } from "@phosphor-icons/react";
import React from "react";

import { connect } from "@/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function StatusBadgeClosed() {
  return (
    <>
      <Badge>
        <span className="bg-destructive size-2 rounded-full" />
        <span>DISCONNECTED</span>
      </Badge>
      <Badge asChild>
        <Button
          onClick={() => {
            connect();
          }}
        >
          <ArrowsCounterClockwiseIcon weight="bold" />
        </Button>
      </Badge>
    </>
  );
}
