// Analytic critically damped spring. Catching it keeps the last displayed position.
export function dragSpring(paint: (position: number) => void) {
  let frame = 0,
    position = 0;
  const stop = () => cancelAnimationFrame(frame);
  const place = (value: number) => {
    position = value;
    paint(value);
  };
  return {
    stop,
    place,
    get position() {
      return position;
    },
    settle(target: number, velocity = 0, done?: () => void) {
      stop();
      const start = performance.now(),
        distance = position - target;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches || (!distance && !velocity)) {
        place(target);
        done?.();
        return;
      }
      const rate = 23,
        impulse = velocity + rate * distance;
      function tick(now: number) {
        const t = (now - start) / 1000;
        const offset = (distance + impulse * t) * Math.exp(-rate * t);
        place(target + offset);
        if (t < 0.6 && (Math.abs(offset) > 0.2 || t < 0.05)) frame = requestAnimationFrame(tick);
        else {
          place(target);
          done?.();
        }
      }
      frame = requestAnimationFrame(tick);
    },
  };
}
