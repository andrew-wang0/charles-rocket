"use client";

import { WarningIcon, XIcon } from "@phosphor-icons/react";
import React from "react";

import { client, ConnectionStatus } from "@/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { cn } from "@/lib/util/cn";

type Props = {
  className?: string;
};

export function ControlAbortButton({ className }: Props) {
  const status = useConnectionStatus();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const disabled = pending || status !== ConnectionStatus.CONNECTED;

  function handleOpenChange(nextOpen: boolean) {
    if (pending) return;

    setOpen(nextOpen);
  }

  async function handleAbort() {
    if (disabled) return;

    setPending(true);

    try {
      await client.abort(undefined);
      setOpen(false);
    } catch (error) {
      console.error("Failed to abort sequence", error);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        aria-label="Abort sequence"
        className={cn(className)}
        disabled={disabled}
        onClick={() => setOpen(true)}
        size="xs"
        type="button"
        variant="destructive"
      >
        <WarningIcon data-icon="inline-start" weight="fill" />
        ABORT
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent aria-describedby={undefined} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Abort sequence?</DialogTitle>
            <DialogClose asChild>
              <Button
                aria-label="Close abort confirmation"
                disabled={pending}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <XIcon />
              </Button>
            </DialogClose>
          </DialogHeader>

          <div className="flex gap-2 p-4">
            <DialogClose asChild>
              <Button className="flex-1" disabled={pending} type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              className="flex-1"
              disabled={pending}
              onClick={() => {
                void handleAbort();
              }}
              type="button"
              variant="destructive"
            >
              Abort
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
