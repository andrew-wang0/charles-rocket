"use client";

import { ListPlusIcon, XIcon } from "@phosphor-icons/react";
import React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WidgetLockableButton } from "@/components/widgets/widget-lockable-button";
import { useServo, useServoControl } from "@/hooks/use-servo";
import { cn } from "@/lib/util/cn";
import { ServoState } from "@/types/servo";

const ADDITIONAL_SERVO_CONTROLS = [
  { index: 3, label: "SERVO 4" },
  { index: 4, label: "SERVO 5" },
] as const;

function getServoStatusClassName(state: ServoState) {
  switch (state) {
    case ServoState.OPEN:
      return "text-positive";
    case ServoState.OPENING:
      return "text-positive animate-pulse animation-duration-[250ms]";
    case ServoState.CLOSED:
      return "text-destructive";
    case ServoState.CLOSING:
      return "text-destructive animate-pulse animation-duration-[250ms]";
    default:
      return "text-muted-foreground";
  }
}

function getServoTarget(state: ServoState) {
  return state === ServoState.OPEN || state === ServoState.OPENING
    ? ServoState.CLOSED
    : ServoState.OPEN;
}

type ControlAdditionalServoButtonProps = {
  index: number;
  label: string;
};

function ControlAdditionalServoButton({ index, label }: ControlAdditionalServoButtonProps) {
  const servo = useServo(index);
  const { setServo } = useServoControl();
  const status = servo.state;

  async function handleToggle() {
    if (servo.isBusy) return;

    try {
      await setServo(index, getServoTarget(status));
    } catch (error) {
      console.error(`Failed to switch ${label.toLowerCase()}`, error);
    }
  }

  return (
    <WidgetLockableButton
      className="h-8 w-full gap-1 px-2"
      disabled={servo.isBusy}
      onClick={() => {
        void handleToggle();
      }}
    >
      <span>{label}</span>
      <span className={cn("font-semibold", getServoStatusClassName(status))}>[{status}]</span>
    </WidgetLockableButton>
  );
}

export function ControlAdditionalControls() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button aria-label="Open additional controls" size="xs" type="button" variant="secondary">
          <ListPlusIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Additional Controls</DialogTitle>
          <DialogClose asChild>
            <Button
              aria-label="Close additional controls"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </DialogClose>
        </DialogHeader>

        <div className="flex flex-col gap-2 p-4">
          {ADDITIONAL_SERVO_CONTROLS.map((servo) => (
            <ControlAdditionalServoButton
              key={servo.index}
              index={servo.index}
              label={servo.label}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
