import { useEffect, useRef } from "react";

// Real-time fire on the GPU. `total` stands in the bowl beside the $WIF coin and the flames rise out of its digits;
// `heat` (0..1) is the column's share of $WIF burned, and `flare` bumps it briefly when someone burns.
const W = 436, H = 480; // canvas units; the page scales them to the brazier
const FONT = 150, COIN = 62, GAP = 14, MARGIN = 36;

const VERTEX = `attribute vec2 p; varying vec2 v; void main() { v = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

const FRAGMENT = `precision highp float;
varying vec2 v;
uniform sampler2D source, coin;
uniform vec3 color;
uniform vec4 box;
uniform float time, power, seed, reveal;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
float fbm(vec2 p) {
  float sum = 0., amp = .5;
  for (int i = 0; i < 4; i++) { sum += amp * noise(p); p = p * 2.03 + vec2(1.7, 9.2); amp *= .5; }
  return sum;
}

void main() {
  // Two layers of rising turbulence, the second warped by the first.
  vec2 q = vec2(v.x * 3.1, v.y * 2.1 - time * .95) + seed;
  float slow = fbm(q);
  float fast = fbm(q * 2.2 + vec2(slow * 1.8, -time * 1.35));

  // Walk back down the flame to the fuel. The turbulence bends the path, more the higher it starts, and a little
  // per-pixel jitter hides the steps.
  float reach = .36 + .68 * power, fuel = 0., jitter = hash(gl_FragCoord.xy + fract(time) * 91.) * .6;
  for (int i = 0; i < 18; i++) {
    float f = (float(i) + jitter) / 18.;
    vec2 p = v - vec2(((slow - .5) * .62 + (fast - .5) * .3) * f, reach * f);
    fuel += texture2D(source, p).g * (1. - f * f * .7);
  }
  fuel *= smoothstep(0., .4, reveal) / 11.;

  // Tips burn away: the further above the fuel, the more heat the noise eats.
  float rise = clamp((v.y - .2) / reach, 0., 1.5);
  float body = fuel * (1.15 + .7 * power) - rise * (.5 + (fast * .7 + slow * .3) * 1.05);
  body = clamp(body * 2.1, 0., 1.);

  vec3 fire = color * (.35 + .75 * smoothstep(0., .6, body));
  fire = mix(fire, mix(color, vec3(1.), .28) * 1.12, smoothstep(.62, .92, body));
  fire = mix(fire, vec3(1., .98, .9), smoothstep(.93, 1., body) * .8);
  float alpha = smoothstep(0., .2, body) * (1. - smoothstep(.88, 1., v.y)) * smoothstep(.0, .05, v.y);

  // A soft light around the fire.
  float glow = fuel * .11;
  vec3 rgb = fire * alpha + color * glow * (1. - alpha);
  alpha = max(alpha, glow * .9);

  // As the page loads, the number fills up from the bowl behind a licking front: shown is how much of each point has
  // formed, rim the bright front where it is forming.
  float line = reveal * .42 - .03 + (fast - .5) * .1;
  float shown = smoothstep(v.y - .01, v.y + .01, line);
  float rim = smoothstep(v.y - .06, v.y, line) - shown;

  // A soft shadow keeps the number readable against its own fire.
  vec2 e = vec2(.022, .02);
  vec4 m = texture2D(source, v);
  float shade = (texture2D(source, v + vec2(e.x, 0.)).r + texture2D(source, v - vec2(e.x, 0.)).r + texture2D(source, v + vec2(0., e.y)).r + texture2D(source, v - vec2(0., e.y)).r
    + texture2D(source, v + e).r + texture2D(source, v - e).r + texture2D(source, v + vec2(e.x, -e.y)).r + texture2D(source, v - vec2(e.x, -e.y)).r) / 8.;
  rgb *= 1. - shade * .72 * shown * smoothstep(.5, 1., reveal);

  // The number stands in the fire white-hot, with embers crawling through it.
  float ember = fbm(vec2(v.x * 22., v.y * 16. - time * 1.5) + seed);
  vec3 digit = mix(vec3(1., .99, .95), mix(color, vec3(1.), .5), smoothstep(.42, .66, ember) * .75);
  digit = mix(digit, mix(color, vec3(1.), .55) * 1.5, clamp(rim * 1.6, 0., 1.));
  rgb = mix(rgb, digit, m.r * max(shown, clamp(rim, 0., 1.)));
  alpha = max(alpha, m.r * max(shown, clamp(rim, 0., 1.)));

  // The logo, as itself.
  vec2 c = (v - box.xy) / box.zw;
  vec4 face = texture2D(coin, vec2(c.x, c.y));
  float on = m.b * face.a * smoothstep(.72, 1., reveal);
  rgb = mix(rgb, face.rgb * 1.2, on);
  alpha = max(alpha, on);

  gl_FragColor = vec4(rgb, alpha);
}`;

const REVEAL = 2400; // ms for the number to rise out of the bowl

const coinImage = new Image();
coinImage.src = "/brand/wif.png";

// The number and coin as a texture: red is the sharp number, green the soft fuel the flames rise from, blue the coin's disc.
function paint(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = `800 ${FONT}px Inter, sans-serif`;
  const width = ctx.measureText(text).width;
  const fit = Math.min(1, (W - MARGIN * 2) / (COIN + GAP + width));
  const size = COIN * fit, left = (W - (COIN + GAP + width) * fit) / 2, base = H - 16;
  const x = left + (width + GAP) * fit, y = base - FONT * 0.364 * fit - size / 2; // beside the number, centred on its height
  ctx.font = `800 ${FONT * fit}px Inter, sans-serif`;
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = "#0f0";
  ctx.shadowBlur = 34;
  ctx.fillStyle = "#0f0";
  ctx.fillText(text, left, base);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#f00";
  ctx.fillText(text, left, base);
  ctx.fillStyle = "#00f";
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  return { canvas, box: [x / W, (H - y - size) / H, size / W, size / H] as const };
}

function compile(gl: WebGLRenderingContext) {
  const program = gl.createProgram()!;
  for (const [type, code] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.bindAttribLocation(program, 0, "p");
  gl.vertexAttribPointer(gl.getAttribLocation(program, "p"), 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return program;
}

function texture(gl: WebGLRenderingContext, unit: number, image: TexImageSource) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

export function Flame({ heat, flare, label, color, total, ready, delay }: { heat: number; flare: number; label: string; color: string; total: string; ready: boolean; delay: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const target = useRef(heat);
  const boost = useRef(0);
  const number = useRef(total);
  const redraw = useRef(() => {});
  const readyAt = useRef<number | null>(null);
  if (ready && readyAt.current == null) readyAt.current = performance.now() + delay;
  target.current = heat;
  number.current = total;

  useEffect(() => {
    boost.current = 1;
  }, [flare]);

  useEffect(() => redraw.current(), [total]);

  useEffect(() => {
    const canvas = ref.current!;
    const scale = Math.min(devicePixelRatio, 1.5) * (canvas.clientWidth / W || 1);
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // No WebGL: the number without the fire. The exact total is under the price either way.
    if (!gl) {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = color;
      ctx.font = `800 ${FONT * scale}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(number.current, canvas.width / 2, canvas.height - 16 * scale);
      return;
    }

    const program = compile(gl);
    const u = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform1i(u("source"), 0);
    gl.uniform1i(u("coin"), 1);
    gl.uniform3f(u("color"), ...rgb(color));
    gl.uniform1f(u("seed"), Math.random() * 40);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    let painted = "", level = target.current, raf = 0, last = 0;
    const start = performance.now();
    const paintNumber = () => {
      const { canvas: art, box } = paint(number.current);
      texture(gl, 0, art);
      gl.uniform4f(u("box"), ...box);
      painted = number.current;
    };
    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      if (painted !== number.current) paintNumber();
      level += (target.current - level) * Math.min(1, dt * 2.4);
      boost.current *= Math.pow(0.05, dt);
      gl.uniform1f(u("time"), (now - start) / 1000);
      gl.uniform1f(u("reveal"), still ? 1 : readyAt.current == null ? 0 : Math.min(1, Math.max(0, (now - readyAt.current) / REVEAL)));
      gl.uniform1f(u("power"), Math.min(1, 0.22 + 0.78 * Math.sqrt(level) + boost.current * 0.4));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now: number) => {
      render(now);
      raf = requestAnimationFrame(loop);
    };
    // With reduced motion the fire holds still and redraws only when its number changes.
    const begin = () => {
      texture(gl, 1, coinImage);
      gl.generateMipmap(gl.TEXTURE_2D); // keeps the logo crisp at this small size
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (still) (redraw.current = () => render(performance.now()))();
      else raf = requestAnimationFrame(loop);
    };
    if (coinImage.complete && coinImage.naturalWidth) begin();
    else coinImage.addEventListener("load", begin, { once: true });
    document.fonts.load("800 20px Inter").then(() => { painted = ""; redraw.current(); }).catch(() => {});
    return () => {
      cancelAnimationFrame(raf);
      coinImage.removeEventListener("load", begin);
    };
  }, [color]);

  return <canvas ref={ref} width={W} height={H} className="flame" role="img" aria-label={label} />;
}
