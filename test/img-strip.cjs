
const sharp = require('sharp');
const path = require('path');
const dir = 'E:\\Nexora\\dsh-navigation-bar\\ref_picture';
const rgb = (px, i) => [px[i], px[i+1], px[i+2]];
const key = (c) => c[0]+','+c[1]+','+c[2];
const near = (a, b, tol=16) => Math.abs(a[0]-b[0])<=tol && Math.abs(a[1]-b[1])<=tol && Math.abs(a[2]-b[2])<=tol;

async function strip(file) {
  const img = sharp(path.join(dir, file));
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  console.log('\n===== ' + file + ' strip =====');
  // background = top color
  const freq = new Map();
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const k = key(rgb(data, (y*W+x)*C));
    freq.set(k, (freq.get(k)||0)+1);
  }
  const bg = [...freq.entries()].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number);
  // only scan x in [0..36]
  const bars = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x <= 36) {
      const c = rgb(data, (y*W+x)*C);
      if (!near(c, bg, 20)) {
        let x1 = x; const colors = new Map();
        while (x1 <= 36) {
          const cc = rgb(data, (y*W+x1)*C);
          if (near(cc, bg, 20)) break;
          colors.set(key(cc), (colors.get(key(cc))||0)+1);
          x1++;
        }
        const dom = [...colors.entries()].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number);
        bars.push({ y, x0: x, len: x1-x, color: dom });
        x = x1;
      } else x++;
    }
  }
  // merge rows (bar height 2) — bars are 2px tall at 10px pitch
  const merged = [];
  for (const b of bars) {
    const g = merged[merged.length-1];
    if (g && b.y - g.y1 <= 2 && b.x0 === g.x0) { g.y1 = b.y; g.rows++; g.lens.push(b.len); g.colors.set(key(b.color), (g.colors.get(key(b.color))||0)+1); }
    else merged.push({ y0: b.y, y1: b.y, x0: b.x0, rows: 1, lens: [b.len], colors: new Map([[key(b.color),1]]) });
  }
  for (const g of merged.filter(g => g.rows >= 1 && g.y1 - g.y0 <= 3 && g.x0 >= 4 && g.x0 <= 30)) {
    const dom = [...g.colors.entries()].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number);
    console.log('y=' + g.y0 + '..' + g.y1 + ' x0=' + g.x0 + ' len=' + Math.max(...g.lens) + ' rgb(' + dom.join(',') + ')');
  }
}
(async () => {
  await strip('浅色模式悬停参考图.png');
  await strip('深色模式悬停参考图.png');
})();
