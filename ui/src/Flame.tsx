import { useEffect, useRef } from "react";

// Real-time fire on the GPU. `total` stands in the bowl beside the $WIF coin and the flames rise out of its digits;
// `heat` (0..1) is the column's share of $WIF burned, and `flare` bumps it briefly when someone burns.
const W = 436, H = 480, FULL = 773, FLOOR = 293; // canvas units: the fire is the top H of the FULL height, above the FLOOR
const FONT = 150, COIN = 62, GAP = 14, MARGIN = 36;

const VERTEX = `attribute vec2 p; varying vec2 uv; void main() { uv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

const FRAGMENT = `precision highp float;
varying vec2 uv;
uniform sampler2D source, coin;
uniform vec3 color;
uniform vec4 box;
uniform float time, power, seed, reveal, pix, wait;
const vec2 SIZE = vec2(${W}., ${FULL}.);

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

float leg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  return length(pa - ba * h) - mix(16., 9., h);
}

void main() {
  vec2 v = vec2(uv.x, (uv.y * SIZE.y - ${FLOOR}.) / ${H}.);

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
  float glow = fuel * .11 * step(0., v.y);
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

  // The cauldron is cast iron lit by its own fire: while the page loads its embers smoulder, then it heats as the flames rise.
  {
    vec2 p = uv * SIZE - vec2(218., 333.);
    float aa = pix * 1.5;
    float light = max(smoothstep(0., .55, reveal) * (.5 + .5 * power) * (.84 + .16 * noise(vec2(time * 2.6, seed))), wait * (.24 + .16 * sin(time * 2.8 + seed)));
    vec3 hot = mix(color, vec3(1.), .45);

    // Behind the fire: its pool of light on the ground, the far wall through the mouth and the back of the lip.
    float lip = length(p / vec2(186., 21.));
    vec2 g = (p - vec2(0., -318.)) / vec2(124., 12.);
    float pool = exp(-dot(g, g) * 1.5) * light * .22;
    float mouth = 1. - smoothstep(1. - aa / 21., 1., lip);
    float ring = 1. - smoothstep(0., aa / 21., abs(lip - 1.) - .05);
    vec3 back = color * pool + mouth * mix(vec3(.018), color * (.16 + .5 * (1. - lip)), light);
    back = mix(back, mix(vec3(.17), hot, light), ring * step(0., p.y));
    float backA = max(max(pool * .8, mouth), ring * step(0., p.y));
    rgb += back * (1. - alpha);
    alpha += backA * (1. - alpha);

    // In front of it: three legs, then the bowl, whose lip hides the foot of the number.
    float d = min(min(leg(p, vec2(-112., -110.), vec2(-160., -322.)), leg(p, vec2(112., -110.), vec2(160., -322.))), leg(p, vec2(0., -150.), vec2(0., -328.)));
    float legs = 1. - smoothstep(-aa, aa, d);
    vec3 legC = vec3(.075, .077, .086) + color * light * .34 * smoothstep(-330., -110., p.y);
    rgb = mix(rgb, legC, legs);
    alpha = max(alpha, legs);

    vec2 q = p / vec2(186., 178.);
    float arc = -21. * sqrt(max(0., 1. - q.x * q.x));
    float bowl = (1. - smoothstep(1. - aa / 186., 1., length(q))) * smoothstep(arc + aa, arc - aa, p.y);
    float z = sqrt(max(0., 1. - dot(q, q)));
    vec3 n = normalize(vec3(q, z)), l = normalize(vec3(0., 1., .5));
    float diff = max(dot(n, l), 0.), spec = pow(max(dot(reflect(-l, n), vec3(0., 0., 1.)), 0.), 14.);
    vec3 iron = vec3(.085, .087, .098) * (.75 + .5 * fbm(p * .07 + seed)) * (.55 + .6 * z);
    // The metal is hottest under the lip, and fine cracks carry the heat down into it.
    float rise = smoothstep(-135., -8., p.y), crack = abs(fbm(p * vec2(.009, .014) + vec2(seed, -time * .08)) - .5);
    float veins = (smoothstep(.07, 0., crack) * .32 + smoothstep(.018, 0., crack) * .75) * smoothstep(-160., -30., p.y);
    vec3 metal = iron + color * light * (rise * rise * .62 + diff * diff * .4 + spec * .35) + mix(color, vec3(1.), .18) * veins * light;
    rgb = mix(rgb, metal, bowl);
    alpha = max(alpha, bowl);

    float front = ring * step(p.y, 0.);
    rgb = mix(rgb, mix(vec3(.17), hot, light), front);
    alpha = max(alpha, front);
  }

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
  const fit = Math.min(1, (W - (COIN + GAP) * 2 - MARGIN) / width); // the number stays centred, so the logo needs room on both sides
  const size = COIN * fit, left = (W - width * fit) / 2, base = H - 16;
  const x = left + (width + GAP) * fit, y = base - FONT * 0.364 * fit - size / 2; // hangs off the number, centred on its height
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
    canvas.height = Math.round(FULL * scale);
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // No WebGL: the number without the fire. The exact total is under the price either way.
    if (!gl) {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#2b2d33";
      ctx.beginPath();
      ctx.ellipse(218 * scale, (FULL - 333) * scale, 186 * scale, 178 * scale, 0, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = `800 ${FONT * scale}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(number.current, canvas.width / 2, (FULL - 345) * scale);
      return;
    }

    const program = compile(gl);
    const u = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform1i(u("source"), 0);
    gl.uniform1i(u("coin"), 1);
    gl.uniform3f(u("color"), ...rgb(color));
    gl.uniform1f(u("seed"), Math.random() * 40);
    gl.uniform1f(u("pix"), W / canvas.width);
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
      gl.uniform1f(u("wait"), readyAt.current == null ? 1 : 0);
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

  return <canvas ref={ref} width={W} height={FULL} className="flame" role="img" aria-label={label} />;
}
