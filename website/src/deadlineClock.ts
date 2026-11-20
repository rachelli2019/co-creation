// Recompute from wall time: delayed/background ticks must not extend the phase.
export function startDeadlineClock(deadline: number, onTick: (seconds: number) => void) {
  const tick = () => onTick(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  tick();
  const timer = setInterval(tick, 250);
  return () => clearInterval(timer);
}
