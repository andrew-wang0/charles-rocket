"use client";

import { GearIcon, XIcon } from "@phosphor-icons/react";
import React from "react";

import { reconnect } from "@/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useBackendHost } from "@/hooks/use-backend-host";
import {
  getDefaultBackendHost,
  getStoredBackendHost,
  normalizeBackendHostInput,
  setBackendHost,
} from "@/lib/backend-host";
import { cn } from "@/lib/util/cn";

export function ConnectionSettings() {
  const backendHost = useBackendHost();
  const defaultHost = getDefaultBackendHost();
  const [open, setOpen] = React.useState(false);
  const [draftHost, setDraftHost] = React.useState(backendHost);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setDraftHost(backendHost);
    }

    setOpen(nextOpen);
  }

  function applyHost(nextHost: string | null) {
    const previousHost = backendHost;
    setBackendHost(nextHost);
    const resolvedHost = nextHost ?? defaultHost;

    if (resolvedHost !== previousHost) {
      reconnect();
    }
  }

  function handleSave(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedHost = normalizeBackendHostInput(draftHost);
    if (!normalizedHost) return;

    applyHost(normalizedHost);
    setOpen(false);
  }

  function handleReset() {
    applyHost(null);
    setDraftHost(defaultHost);
    setOpen(false);
  }

  const usingOverride = getStoredBackendHost() !== null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Badge asChild className="border-l-0">
          <Button aria-label="Connection settings" type="button">
            <GearIcon weight="bold" />
          </Button>
        </Badge>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hardware Host</DialogTitle>
          <DialogClose asChild>
            <Button
              aria-label="Close connection host settings"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </DialogClose>
        </DialogHeader>

        <form className="flex flex-col gap-4 p-4" onSubmit={handleSave}>
          <input
            aria-label="Hardware host (Pi)"
            autoComplete="off"
            className={cn(
              "border-border bg-background h-8 w-full rounded-none border px-2 text-xs outline-none",
              "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-1",
            )}
            id="backend-host"
            name="backendHost"
            onChange={(event) => setDraftHost(event.target.value)}
            placeholder={defaultHost}
            spellCheck={false}
            value={draftHost}
          />

          <div className="flex items-center justify-end gap-2">
            <Button disabled={!usingOverride} onClick={handleReset} type="button" variant="outline">
              Reset
            </Button>
            <Button disabled={!normalizeBackendHostInput(draftHost)} type="submit">
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
