import { useMemo } from "react";

const COLOURS = ["bg-ticket", "bg-brand", "bg-hot", "bg-sky", "bg-violet"];

/** A one-shot burst of CSS confetti. Decorative and hidden from screen readers. */
export function Confetti({ pieces = 200 }: { pieces?: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 5,
        duration: 2 + Math.random() * 1.6,
        dx: (Math.random() - 0.5) * 240,
        spin: 360 + Math.random() * 900,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 10,
        round: i % 4 === 0,
        colour: COLOURS[i % COLOURS.length],
      })),
    [pieces],
  );
  return (
    <div
      className="pointer-events-none fixed inset-0 z-70 overflow-hidden"
      aria-hidden="true"
    >
      {bits.map((b, i) => (
        <span
          key={i}
          className={`absolute top-0 animate-confetti ${b.colour} ${b.round ? "rounded-full" : "rounded-xs"}`}
          style={
            {
              left: `${b.left}%`,
              width: b.w,
              height: b.round ? b.w : b.h,
              animationDelay: `${b.delay}s`,
              animationDuration: `${b.duration}s`,
              "--dx": `${b.dx}px`,
              "--spin": `${b.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
