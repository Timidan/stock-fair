// The one bespoke animation: your burned $WIF flies into the brazier you picked.
// Halftone dots thrown on an arc from the Burn button into the bowl.
export function emberFlight(from: Element, to: Element): Promise<void> {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
  const x1 = b.left + b.width / 2, y1 = b.top + b.height * 0.5; // the bowl rim
  const peak = Math.min(y0, y1) - 120; // arc up out of the panel, then fall into the bowl
  const layer = document.createElement("div");
  layer.className = "embers";
  document.body.append(layer);
  const flights = Array.from({ length: 22 }, (_, i) => {
    const dot = document.createElement("span");
    const size = 5 + Math.random() * 6;
    dot.style.cssText = `width:${size}px;height:${size}px;left:${x0 - size / 2}px;top:${y0 - size / 2}px;background:${i % 4 ? "#d4fc50" : "#f7f5f1"}`;
    layer.append(dot);
    const spread = (Math.random() - 0.5) * 60;
    const frames = Array.from({ length: 9 }, (_, k) => {
      const t = k / 8, u = 1 - t;
      const x = u * u * x0 + 2 * u * t * ((x0 + x1) / 2 + spread) + t * t * x1 - x0;
      const y = u * u * y0 + 2 * u * t * peak + t * t * y1 - y0;
      return { transform: `translate(${x}px, ${y}px) scale(${1 - t * 0.45})`, opacity: t < 0.9 ? 1 : 0 };
    });
    // Linear time on a quadratic arc is a true throw: steady sideways, gravity on the way down.
    return dot.animate(frames, { duration: 620 + Math.random() * 180, delay: i * 22, easing: "linear", fill: "forwards" }).finished;
  });
  return Promise.all(flights).then(() => layer.remove());
}

// Adds `.inview` once an element scrolls into view; CSS owns the actual motion.
export function revealOnScroll(root: ParentNode = document) {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("inview"), io.unobserve(e.target))),
    { threshold: 0.25 },
  );
  root.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  return () => io.disconnect();
}
