"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import React from "react";

import { ServoManualControlUnit } from "@/components/widgets/servo-widget/servo-manual-control-unit";
import { cn } from "@/lib/utils";
import {
  SERVO_CHANNELS,
  type ServoChannel,
  type ServoChannelState,
  type ServoStatePayload,
} from "@/types/websocket";

type Props = {
  canSendCommands: boolean;
  servoState: ServoStatePayload;
  onSwitchServo: (channel: ServoChannel) => void;
} & React.ComponentProps<"div">;

function getServoState(channels: ServoChannelState[], channel: ServoChannel): ServoChannelState {
  return (
    channels.find((servo) => servo.channel === channel) ?? {
      channel,
      state: "unknown",
    }
  );
}

export function ServoManualControl({
  className,
  canSendCommands,
  servoState,
  onSwitchServo,
  ...props
}: Props) {
  return (
    <div className={cn("flex items-center justify-around", className)} {...props}>
      {SERVO_CHANNELS.map((channel, index) => (
        <React.Fragment key={channel}>
          {index > 0 ? <ArrowRightIcon weight="bold" /> : null}
          <ServoManualControlUnit
            canSendCommands={canSendCommands}
            servo={getServoState(servoState.channels, channel)}
            onSwitch={onSwitchServo}
          />
        </React.Fragment>
      ))}
    </div>
  );
}
