# Usage: python3 ui/scripts/mark.py animated > ui/public/brand/mark.svg  (or `static` for mark-static.svg / favicon.svg)
# Writes the Stock Fair mark: a halftone flame (offset dot grid, like the live fire) over a brazier bowl.
import math, sys
animated = sys.argv[1] == "animated"
dots = []
for row in range(12):                      # row 0 = base of the flame
    y = 40 - row * 3.1
    t = row / 11
    half = 11.5 * (1 - t) ** 1.6 + 0.6           # concave sides: a flame, not a cone
    sway = 2.6 * math.sin(row * 0.62)             # the centre line licks left and right
    off = 1.55 if row % 2 else 0
    x = -12 + off
    while x <= 12:
        if abs(x - sway) <= half:
            heat = max(0.12, 1 - row / 10 - abs(x - sway) / (half + 2) * 0.6)
            r = round(0.35 + 1.25 * heat, 2)
            fill = "#f7f5f1" if heat > 0.78 else "#d4fc50"
            dots.append((round(32 + x, 2), round(y, 2), r, fill, row))
        x += 3.1
out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Stock Fair">']
if animated:
    out.append('<style>.d{transform-box:fill-box;transform-origin:center;animation:f 1.6s ease-in-out infinite alternate}'
               '@keyframes f{from{opacity:.55;transform:translateY(.6px) scale(.8)}to{opacity:1;transform:translateY(-.8px) scale(1.08)}}'
               '@media (prefers-reduced-motion:reduce){.d{animation:none}}</style>')
out.append('<g>')
for i, (x, y, r, fill, row) in enumerate(dots):
    delay = f' style="animation-delay:-{(row * 0.17 + (i % 5) * 0.23) % 1.6:.2f}s"' if animated else ""
    cls = ' class="d"' if animated else ""
    out.append(f'<circle{cls} cx="{x}" cy="{y}" r="{r}" fill="{fill}"{delay}/>')
out.append('</g>')
# Brazier: rim, bowl and three legs, in engraving ink.
out.append('<g fill="#eae6de"><rect x="13" y="42.5" width="38" height="2.6" rx="1.3"/>'
           '<path d="M16 45.8h32c-1.4 5-6 7.8-16 7.8s-14.6-2.8-16-7.8z"/>'
           '<path d="M21.5 52.4l-2.8 7.6h2.6l3-6.6zM42.5 52.4l2.8 7.6h-2.6l-3-6.6zM30.9 53.6h2.2v6.4h-2.2z"/></g>')
out.append('</svg>')
print("".join(out))
