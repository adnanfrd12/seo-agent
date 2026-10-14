"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { Avatar } from "@/components/layout/avatar";
import { createClient } from "@/lib/supabase/client";

const VIEW = 256; // crop viewport (px)
const OUT = 512; // exported image size (px)
const MAX_BYTES = 8 * 1024 * 1024;

type Pos = { x: number; y: number };

/**
 * Pick → crop (drag to position, slider/keys to zoom) → upload to the public `avatars` bucket under
 * the user's own folder (storage RLS enforces the folder) → returns the public URL.
 */
export function AvatarEditor({
  userId, email, name, current, onChange,
}: {
  userId: string; email: string; name: string | null; current: string | null;
  onChange: (url: string | null) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ start: Pos; from: Pos } | null>(null);

  const base = img ? Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) : 1;
  const dw = img ? img.naturalWidth * base * zoom : VIEW;
  const dh = img ? img.naturalHeight * base * zoom : VIEW;

  // keep the image covering the whole circle
  const clampFor = (p: Pos, w: number, h: number): Pos =>
    ({ x: Math.min(0, Math.max(VIEW - w, p.x)), y: Math.min(0, Math.max(VIEW - h, p.y)) });
  const clamp = (p: Pos) => clampFor(p, dw, dh);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setError(null);
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setError("Choose a JPG, PNG or WebP image.");
    if (file.size > MAX_BYTES) return setError("That image is over 8 MB. Choose a smaller one.");
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const b = Math.max(VIEW / im.naturalWidth, VIEW / im.naturalHeight);
      setImg(im);
      setZoom(1);
      setPos({ x: (VIEW - im.naturalWidth * b) / 2, y: (VIEW - im.naturalHeight * b) / 2 });
    };
    im.onerror = () => setError("That file couldn't be read as an image.");
    im.src = url;
  }

  function zoomTo(z: number) {
    if (!img) return;
    const nz = Math.min(4, Math.max(1, z));
    // zoom around the centre of the circle
    const cx = VIEW / 2, cy = VIEW / 2;
    const ratio = nz / zoom;
    setZoom(nz);
    setPos(clampFor({ x: cx - (cx - pos.x) * ratio, y: cy - (cy - pos.y) * ratio }, dw * ratio, dh * ratio));
  }

  async function save() {
    if (!img) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = OUT;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      const k = OUT / VIEW;
      ctx.drawImage(img, pos.x * k, pos.y * k, dw * k, dh * k);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.9));
      if (!blob) throw new Error("Could not process the image.");
      const supabase = createClient();
      const path = `${userId}/avatar-${Date.now()}.webp`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, blob, {
        contentType: "image/webp", upsert: false, cacheControl: "31536000",
      });
      if (upErr) throw new Error("Upload failed. Please try again.");
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      await onChange(data.publicUrl);
      setImg(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try { await onChange(null); } finally { setBusy(false); }
  }

  return (
    <div>
      {!img ? (
        <div className="flex flex-wrap items-center gap-4">
          <Avatar src={current} name={name} email={email} size={80} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-50">
              <Camera className="size-4" aria-hidden /> {current ? "Change photo" : "Upload photo"}
            </button>
            {current && (
              <button type="button" onClick={remove} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-negative hover:bg-surface-muted disabled:opacity-50">
                <Trash2 className="size-4" aria-hidden /> Remove
              </button>
            )}
          </div>
          <p className="w-full text-xs text-muted">JPG, PNG or WebP, up to 8 MB. You can crop it before saving.</p>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">Drag to position, zoom to fit, then save.</p>
          <div
            role="application" aria-label="Crop photo. Use arrow keys to move, plus and minus to zoom." tabIndex={0}
            className="relative cursor-grab touch-none overflow-hidden rounded-full bg-surface-muted outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              drag.current = { start: { x: e.clientX, y: e.clientY }, from: pos };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const d = drag.current;
              setPos(clamp({ x: d.from.x + e.clientX - d.start.x, y: d.from.y + e.clientY - d.start.y }));
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onWheel={(e) => zoomTo(zoom - e.deltaY * 0.002)}
            onKeyDown={(e) => {
              const step = 10;
              const moves: Record<string, Pos> = {
                ArrowLeft: { x: step, y: 0 }, ArrowRight: { x: -step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step },
              };
              if (moves[e.key]) { e.preventDefault(); setPos(clamp({ x: pos.x + moves[e.key].x, y: pos.y + moves[e.key].y })); }
              if (e.key === "+" || e.key === "=") zoomTo(zoom + 0.1);
              if (e.key === "-") zoomTo(zoom - 0.1);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
            <img src={img.src} alt="" draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
              style={{ width: dw, height: dh, transform: `translate(${pos.x}px, ${pos.y}px)` }} />
          </div>
          <div className="flex w-64 items-center gap-2">
            <ZoomOut className="size-4 text-muted" aria-hidden />
            <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))}
              aria-label="Zoom" className="flex-1 accent-[var(--accent)]" />
            <ZoomIn className="size-4 text-muted" aria-hidden />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">
              {busy && <Loader2 className="size-4 animate-spin" />} Save photo
            </button>
            <button type="button" onClick={() => setImg(null)} disabled={busy}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted">
              Cancel
            </button>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />
      {error && <p role="alert" className="mt-2 text-sm text-negative">{error}</p>}
    </div>
  );
}
