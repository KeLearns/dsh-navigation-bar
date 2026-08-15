
const sharp = require('sharp');
const path = require('path');

const dir = 'E:\\Nexora\\dsh-navigation-bar\\ref_picture';
const rgb = (px, i) => [px[i], px[i+1], px[i+2]];
const key = (c) => c[0]+','+c[1]+','+c[2];
const near = (a, b, tol=12) => Math.abs(a[0]-b[0])<=tol && Math.abs(a[1]-b[1])<=tol && Math.abs(a[2]-b[2])<=tol;

async function analyze(file, { full }) {
  const img = sharp(path.join(dir, file));
  const meta = await img.metadata();
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  console.log('\n===== ' + file + ' (' + W + 'x' + H + ') =====');
  // scan every row: find maximal horizontal runs of "non-background" pixels
  // background = most common color
  const freq = new Map();
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
    const k = key(rgb(data, (y*W+x)*C));
    freq.set(k, (freq.get(k)||0)+1);
  }
  const bg = [...freq.entries()].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number);
  console.log('bg guess:', bg.join(','));
  const bars = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const c = rgb(data, (y*W+x)*C);
      if (!near(c, bg, 18)) {
        let x1 = x;
        let colors = new Map();
        while (x1 < W) {
          const cc = rgb(data, (y*W+x1)*C);
          if (near(cc, bg, 18)) break;
          colors.set(key(cc), (colors.get(key(cc))||0)+1);
          x1++;
        }
        const dom = [...colors.entries()].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number);
        bars.push({ y, x0: x, x1: x1-1, len: x1-x, color: dom, colors });
        x = x1;
      } else x++;
    }
  }
  // merge adjacent rows into bars (a bar spans several y rows)
  const groups = [];
  for (const b of bars) {
    const g = groups[groups.length-1];
    if (g && b.y - g.y1 <= 2 && Math.abs(b.x0 - g.x0) <= 3) { g.y1 = b.y; g.rows++; g.lens.push(b.len); g.colors.set(key(b.color), (g.colors.get(key(b.color))||0)+1); }
    else groups.push({ y0: b.y, y1: b.y, x0: b.x0, x1: b.x1, rows: 1, lens: [b.len], colors: new Map([[key(b.color),1]]) });
  }
  const out = groups.filter(g => g.rows >= 2 && g.y1 - g.y0 <= 8).map(g => {
    const dom = [...g.colors.entries()].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number);
    return { y: Math.round((g.y0+g.y1)/2), h: g.y1-g.y0+1, x0: g.x0, len: Math.max(...g.lens), color: dom };
  }).filter(g => g.len >= 3);
  // print compact
  console.log('bars(' + out.length + '):');
  for (const g of out) console.log('  y=' + g.y + ' h=' + g.h + ' x0=' + g.x0 + ' len=' + g.len + ' rgb(' + g.color.join(',') + ')');
  // also detect left-dot markers: pixels left of bar start at same y
  return out;
}

(async () => {
  await analyze('浅色模式非悬停态参考图.png', { full: false });
  await analyze('深色模式非悬停态参考图.png', { full: false });
})();
