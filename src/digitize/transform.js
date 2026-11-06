// Image preparation geometry: rotation about the image centre followed by a crop.
// working(px,py) <-> original(ox,oy), so every digitised point stays traceable to the source image.

const rad = (deg) => (deg * Math.PI) / 180;

/** Size of the canvas that exactly contains the rotated original. */
export function rotatedSize(W, H, deg) {
  const t = rad(deg), c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  return { w: Math.round(W * c + H * s), h: Math.round(W * s + H * c) };
}

/** processing: { rotation (deg, any real), crop: {x,y,w,h} | null } in rotated-canvas pixels. */
export function workingSize(W, H, p) {
  const r = rotatedSize(W, H, p.rotation || 0);
  return p.crop ? { w: Math.round(p.crop.w), h: Math.round(p.crop.h) } : r;
}

export function workingToOriginal(px, py, W, H, p) {
  const t = rad(p.rotation || 0), r = rotatedSize(W, H, p.rotation || 0);
  const rx = px + (p.crop ? p.crop.x : 0), ry = py + (p.crop ? p.crop.y : 0);
  const dx = rx - r.w / 2, dy = ry - r.h / 2;
  return { ox: W / 2 + dx * Math.cos(t) + dy * Math.sin(t), oy: H / 2 - dx * Math.sin(t) + dy * Math.cos(t) };
}

export function originalToWorking(ox, oy, W, H, p) {
  const t = rad(p.rotation || 0), r = rotatedSize(W, H, p.rotation || 0);
  const dx = ox - W / 2, dy = oy - H / 2;
  const rx = r.w / 2 + dx * Math.cos(t) - dy * Math.sin(t);
  const ry = r.h / 2 + dx * Math.sin(t) + dy * Math.cos(t);
  return { px: rx - (p.crop ? p.crop.x : 0), py: ry - (p.crop ? p.crop.y : 0) };
}

/** Draw the prepared (rotated + cropped) image onto a canvas of workingSize(). */
export function drawWorking(ctx, img, W, H, p) {
  const r = rotatedSize(W, H, p.rotation || 0);
  ctx.save();
  if (p.crop) ctx.translate(-p.crop.x, -p.crop.y);
  ctx.translate(r.w / 2, r.h / 2);
  ctx.rotate(rad(p.rotation || 0));
  ctx.drawImage(img, -W / 2, -H / 2, W, H);
  ctx.restore();
}
