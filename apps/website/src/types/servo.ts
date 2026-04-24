export enum ServoState {
  OPEN = "OPEN",
  OPENING = "OPENING",
  CLOSED = "CLOSED",
  CLOSING = "CLOSING",
  UNKNOWN = "UNKNOWN",
}

export type Servo = {
  state: ServoState;
  isSwitching: boolean;
  isOpen: boolean;
  isClosed: boolean;
};
