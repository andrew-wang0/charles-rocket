import { z } from "zod";

export const SERVO_CHANNELS = [0, 1, 2] as const;

export enum ServoStatus {
  OPENING = "opening",
  OPEN = "open",
  CLOSING = "closing",
  CLOSED = "closed",
}

export const ServoChannelSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export const ServoStableStateSchema = z.enum(["open", "closed"]);
export const ServoTransitionStateSchema = z.enum(["opening", "closing"]);
export const ServoStatusSchema = z.enum(ServoStatus);

export const ServoChannelStateSchema = z.object({
  channel: ServoChannelSchema,
  state: ServoStatusSchema,
});

export const ServoStatePayloadSchema = z.object({
  channels: z.array(ServoChannelStateSchema),
});

export const ServoStateMessageSchema = z.object({
  type: z.literal("state"),
  servo: ServoStatePayloadSchema,
});

export const HardwareErrorMessageSchema = z.object({
  type: z.literal("error"),
  error: z.string(),
});

// Add future Pi telemetry messages here, e.g. load-cell and PT sensor readings.
export const HardwareServerMessageSchema = z.discriminatedUnion("type", [
  ServoStateMessageSchema,
  HardwareErrorMessageSchema,
]);

export type ServoChannel = z.infer<typeof ServoChannelSchema>;
export type ServoStableState = z.infer<typeof ServoStableStateSchema>;
export type ServoTransitionState = z.infer<typeof ServoTransitionStateSchema>;
export type ServoChannelState = z.infer<typeof ServoChannelStateSchema>;
export type ServoStatePayload = z.infer<typeof ServoStatePayloadSchema>;
export type ServoStateMessage = z.infer<typeof ServoStateMessageSchema>;
export type HardwareErrorMessage = z.infer<typeof HardwareErrorMessageSchema>;
export type HardwareServerMessage = z.infer<typeof HardwareServerMessageSchema>;

export type HardwareClientMessage =
  | { command: "get_state" }
  | { command: "toggle_servo"; channel: ServoChannel }
  | { command: "open_servo"; channel: ServoChannel }
  | { command: "close_servo"; channel: ServoChannel }
  | { command: "open_all_servos" }
  | { command: "close_all_servos" };

export function parseHardwareServerMessage(message: unknown) {
  return HardwareServerMessageSchema.safeParse(message);
}
