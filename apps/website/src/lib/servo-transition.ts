export const SERVO_FAST_TRANSITION_SECONDS = 0.4;
export const SERVO_SLOW_TRANSITION_SECONDS = 15;
export const SERVO_MEDIUM_SLOW_OPEN_TRANSITION_SECONDS = 2.3;
export const SERVO_ABORT_CLOSE_TRANSITION_SECONDS = SERVO_FAST_TRANSITION_SECONDS;
export const SERVO_ABORT_CLOSE_TRANSITION_MS = SERVO_ABORT_CLOSE_TRANSITION_SECONDS * 1000;

export function getOpeningTransitionSeconds(index: number) {
  if (index === 0 || index === 3) {
    return SERVO_SLOW_TRANSITION_SECONDS;
  }

  if (index === 1 || index === 2) {
    return SERVO_MEDIUM_SLOW_OPEN_TRANSITION_SECONDS;
  }

  return SERVO_FAST_TRANSITION_SECONDS;
}

export function getClosingTransitionSeconds(index: number, options?: { fast?: boolean }) {
  if (options?.fast) {
    return SERVO_FAST_TRANSITION_SECONDS;
  }

  return index === 1 || index === 2 || index === 3
    ? SERVO_SLOW_TRANSITION_SECONDS
    : SERVO_FAST_TRANSITION_SECONDS;
}
