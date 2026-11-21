import { projection, type Mesh } from "./terrainMesh";

const vertex = `#version 300 es
in vec4 geometry; // time, depth, height, previous height
in vec4 gradient;
out vec3 smoothNormal;
out float emergence;
in float material; // terrain, cut face, floor or observed ridge
uniform float blend, opening;
out vec3 world;
flat out float kind;
void main() {
  float rise = smoothstep(0., .42, opening - (1.-geometry.y)*.48 - geometry.x*.10);
  emergence=rise;
  float height = mix(geometry.w, geometry.z, blend)*rise;
  world=vec3(geometry.xy,height);
  kind=material;
  smoothNormal=normalize(vec3(-mix(gradient.zw,gradient.xy,blend)*rise,1.));
  vec2 screen=vec2(${projection.left}+${projection.timeX}*world.x+${projection.depthX}*world.y,
    ${projection.base}+${projection.timeY}*world.x+${projection.depthY}*world.y+${projection.heightY}*height);
  gl_Position=vec4(screen.x*2.-1., 1.-screen.y*2.,
    world.y*.57-world.x*.19-height*.31+(kind==2.? .002 : kind==3.? -.0015 : 0.), 1.);
}`;

const fragment = `#version 300 es
precision highp float;
in vec3 world;
in vec3 smoothNormal;
in float emergence;
flat in float kind;
uniform float litRow, bands, columns, sweep, cursor, fine, lock, breath, peak;
out vec4 color;
float grid(float n, float width) {
  float distance=abs(fract(n+.5)-.5);
  return 1.-smoothstep(0.,max(fwidth(n)*width,.0003),distance);
}
void main() {
  float row=world.y*bands;
  float nearRidge=abs(row-litRow);
  vec3 ink=vec3(.065,.071,.079);
  if(kind==2.) {
    float rule=max(grid(world.x*25.,.8), grid(row,.8));
    color=vec4(mix(ink,vec3(.29,.31,.32),rule*.72),1.); return;
  }
  vec3 coords=world*vec3(1.,.46,.20);
  vec3 n=normalize(cross(dFdx(coords),dFdy(coords)));
  if(n.z<0.) n=-n;
  n=normalize(mix(n,smoothNormal,.72));
  float key=dot(n,normalize(vec3(-.58,-.45,.68)));
  float fillLight=max(0.,dot(n,normalize(vec3(.62,.28,.73))));
  float diffuse=clamp(.075+.85*max(key,0.)+.13*fillLight,0.,1.);
  float fog=world.y*.22;
  vec3 stone=mix(vec3(.15,.16,.173),vec3(.74,.76,.75),pow(diffuse,1.18));
  stone*=.76+.28*world.z;
  stone=mix(stone,vec3(.16,.17,.18),fog);
  float reach=smoothstep(0.,.12,lock*1.14-abs(world.x-peak));
  float lamp=exp(-nearRidge*2.8)*reach*(.94+.06*breath);
  stone+=vec3(.31,.155,.039)*lamp*(.38+.62*diffuse);
  if(kind==1.) {
    stone=mix(vec3(.075,.082,.09),vec3(.24,.26,.27),world.z);
    stone+=vec3(.09)*grid(world.x*66.+world.y*16.,.85);
  } else {
    stone+=vec3(.068)*grid(world.x*columns,.85);
    stone+=vec3(.085)*grid(row*(1.+fine),.85);
    stone+=vec3(.058)*grid(world.z*10.,.85);
  }
  if(kind==3.) stone=mix(vec3(.58,.60,.59)*(1.-fog),vec3(1.,.69,.39),step(nearRidge,.05)*reach);
  float crest=1.-smoothstep(0.,max(fwidth(row)*1.8,.009),nearRidge);
  if(kind==0.) stone=mix(stone,vec3(.95,.66,.37),crest*(.88+.06*breath)*reach);
  float beam=exp(-abs(world.x-sweep)*(cursor>.5?260.:115.));
  float rake = exp(-abs(world.x + world.y*.08 - sweep)*17.);
  stone += cursor>.5 ? vec3(.48,.33,.14)*beam : vec3(.37,.39,.38)*rake*(.36+world.z)*max(key,.32);
  // A short wave travels away from the observed peak as its bracket closes.
  float front=1.-smoothstep(.012,.15,abs(abs(world.x-peak)-lock*.70));
  stone += vec3(1.,.53,.18)*front*exp(-nearRidge*1.5)*smoothstep(0.,.12,lock)*(1.-smoothstep(.62,1.,lock));
  if (emergence < 1.) {
    float engraving = max(grid(world.x*columns,.9),grid(row,.9));
    stone=mix(vec3(.10,.11,.12)+.12*engraving,stone,emergence);
    stone+=vec3(.27,.28,.28)*(4.*emergence*(1.-emergence))*(.32+.68*diffuse);
  }
  color=vec4(stone,1.);
}`;

export async function createTerrainRenderer(canvas: HTMLCanvasElement, signal: AbortSignal) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    depth: true,
  });
  if (!gl) return null;
  const program = gl.createProgram();
  if (!program) return null;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) {
      gl.deleteProgram(program);
      return null;
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  gl.linkProgram(program);
  // LINK_STATUS blocks until compilation completes. Let WebKit finish it off-thread.
  while (
    parallel &&
    !signal.aborted &&
    !gl.isContextLost() &&
    !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)
  ) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  if (signal.aborted || gl.isContextLost() || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  const geometry = gl.getAttribLocation(program, "geometry"),
    material = gl.getAttribLocation(program, "material");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(geometry);
  const stride = 9 * Float32Array.BYTES_PER_ELEMENT;
  gl.vertexAttribPointer(geometry, 4, gl.FLOAT, false, stride, 0);
  const gradient = gl.getAttribLocation(program, "gradient");
  gl.enableVertexAttribArray(gradient);
  gl.vertexAttribPointer(gradient, 4, gl.FLOAT, false, stride, 20);
  gl.enableVertexAttribArray(material);
  gl.vertexAttribPointer(material, 1, gl.FLOAT, false, stride, 16);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clearColor(0, 0, 0, 0);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    active: uniform("litRow"),
    bands: uniform("bands"),
    columns: uniform("columns"),
    sweep: uniform("sweep"),
    cursor: uniform("cursor"),
    blend: uniform("blend"),
    opening: uniform("opening"),
    fine: uniform("fine"),
    peak: uniform("peak"),
    lock: uniform("lock"),
    breath: uniform("breath"),
  };
  let triangles = 0,
    lines = 0;
  type Vertex = { t: number; d: number; h: number; start: number; row: number; col: number };
  let current: { time: number[]; rows: (Vertex | null)[][]; target: Mesh } | null = null;
  let blend = 1;

  function interval(times: number[], t: number) {
    let lo = 0,
      hi = times.length - 1;
    while (hi - lo > 1) {
      const mid = (hi + lo) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    return { lo, hi, f: (t - times[lo]) / (times[hi] - times[lo] || 1) };
  }
  function lerp(a: number | undefined, b: number | undefined, f: number) {
    if (f === 0) return a;
    if (f === 1) return b;
    return a == null || b == null ? undefined : a + (b - a) * f;
  }
  function upload(next: Mesh) {
    const previous = current;
    // Both time grids must survive the transition. Immediately switching to
    // monthly vertices would discard the year's peaks on the first frame.
    const oldTimes = previous && (blend === 1 ? previous.target.time : previous.time);
    const time = oldTimes ? [...new Set([...oldTimes, ...next.time])].sort((a, b) => a - b) : next.time;
    const samples = previous ? time.map((t) => interval(next.time, t)) : [];
    const oldSamples = previous && time.map((t) => interval(previous.time, t));
    // A cold surface already has this exact calendar, depth and height.
    const rows = !previous
      ? next.rows
      : next.rows.map((row, r) => {
          const oldIndex =
            previous?.target.surface.ridges.findIndex((v) => v.symbol === next.surface.ridges[r].symbol) ??
            -1;
          const old = previous?.rows[oldIndex];
          const displayed = (v: Vertex | null) => (v ? v.start + (v.h - v.start) * blend : undefined);
          return time.map((t, c): Vertex | null => {
            const { lo, hi, f } = samples[c];
            const h = lerp(row[lo]?.h, row[hi]?.h, f);
            if (h == null) return null;
            const before = oldSamples?.[c];
            const start =
              old && before ? lerp(displayed(old[before.lo]), displayed(old[before.hi]), before.f) : h;
            return { t, h, start: start ?? h, d: r / Math.max(1, next.rows.length - 1), row: r, col: c };
          });
        });
    // Six floor vertices, up to six per surface quad and skirt segment,
    // plus two per ridge segment. Write straight into the GPU upload format.
    const rCount = rows.length,
      segments = time.length - 1;
    const capacity = 6 + 6 * ((rCount - 1) * segments + segments + rCount - 1) + 2 * rCount * segments;
    const bytes = new Float32Array(9 * capacity);
    let offset = 0;
    function add(
      t: number,
      d: number,
      h: number,
      start: number,
      kind: number,
      sx = 0,
      sy = 0,
      ox = 0,
      oy = 0,
    ) {
      bytes[offset++] = t;
      bytes[offset++] = d;
      bytes[offset++] = h;
      bytes[offset++] = start;
      bytes[offset++] = kind;
      bytes[offset++] = sx;
      bytes[offset++] = sy;
      bytes[offset++] = ox;
      bytes[offset++] = oy;
    }
    for (const [t, d] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
      [1, 1],
      [0, 1],
    ])
      add(t, d, 0, 0, 2);
    type Node = Vertex;
    // Averaging adjacent face normals softens the light, while all observed
    // heights and the depth-tested silhouette retain their exact values.
    const slopes = rows.map((row, r) =>
      row.map((n, c) => {
        if (!n) return [0, 0];
        const left = row[c - 1] ?? n,
          right = row[c + 1] ?? n,
          near = rows[r - 1]?.[c] ?? n,
          far = rows[r + 1]?.[c] ?? n;
        return [
          (0.2 * (right.h - left.h)) / (right.t - left.t || 1),
          ((0.2 / 0.46) * (far.h - near.h)) / (far.d - near.d || 1),
          (0.2 * (right.start - left.start)) / (right.t - left.t || 1),
          ((0.2 / 0.46) * (far.start - near.start)) / (far.d - near.d || 1),
        ];
      }),
    );
    const put = (n: Node, kind: number, bottom = false) => {
      const [sx, sy, ox, oy] = slopes[n.row][n.col];
      add(n.t, n.d, bottom ? 0 : n.h, bottom ? 0 : n.start, kind, sx, sy, ox, oy);
    };
    for (let r = 1; r < rows.length; r++) {
      for (let c = 1; c < time.length; c++) {
        const a = rows[r - 1][c - 1],
          b = rows[r - 1][c],
          e = rows[r][c],
          f = rows[r][c - 1];
        if (a && b && e && f) {
          put(a, 0);
          put(b, 0);
          put(e, 0);
          put(a, 0);
          put(e, 0);
          put(f, 0);
        }
      }
    }
    function skirt(a: Node | null, b: Node | null) {
      if (!a || !b) return;
      put(a, 1);
      put(b, 1);
      put(b, 1, true);
      put(a, 1);
      put(b, 1, true);
      put(a, 1, true);
    }
    for (let c = 1; c < time.length; c++) skirt(rows[0][c - 1], rows[0][c]);
    for (let r = 1; r < rows.length; r++) skirt(rows[r - 1].at(-1)!, rows[r].at(-1)!);
    triangles = offset / 9;
    for (const row of rows)
      for (let c = 1; c < row.length; c++) {
        const a = row[c - 1],
          b = row[c];
        if (a && b) {
          put(a, 3);
          put(b, 3);
        }
      }
    lines = offset / 9 - triangles;
    current = { time, rows, target: next };
    blend = previous ? 0 : 1;
    gl!.bufferData(gl!.ARRAY_BUFFER, bytes.subarray(0, offset), gl!.STATIC_DRAW);
    gl!.uniform1f(uniforms.bands, Math.max(1, next.rows.length - 1));
    gl!.uniform1f(uniforms.columns, next.time.length > 100 ? 24 : Math.min(35, next.time.length));
    gl!.uniform1f(uniforms.fine, next.time.length > 100 ? 0 : 1);
  }
  return {
    upload,
    height(row: number, t: number) {
      if (!current) return;
      const { lo, hi, f } = interval(current.time, t);
      const shown = (v: Vertex | null) => (v ? v.start + (v.h - v.start) * blend : undefined);
      return lerp(shown(current.rows[row][lo]), shown(current.rows[row][hi]), f);
    },
    draw(
      row: number,
      sweep: number,
      inspecting: boolean,
      progress: number,
      opening: number,
      lock: number,
      breath: number,
    ) {
      blend = progress;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(uniforms.active, row);
      gl.uniform1f(uniforms.sweep, sweep);
      gl.uniform1f(uniforms.cursor, inspecting ? 1 : 0);
      gl.uniform1f(uniforms.blend, blend);
      gl.uniform1f(uniforms.opening, opening);
      gl.uniform1f(uniforms.peak, current?.target.peaks[row]?.t ?? 0);
      gl.uniform1f(uniforms.lock, lock);
      gl.uniform1f(uniforms.breath, breath);
      gl.drawArrays(gl.TRIANGLES, 0, triangles);
      gl.drawArrays(gl.LINES, triangles, lines);
    },
    destroy() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
