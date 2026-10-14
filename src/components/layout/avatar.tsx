import { cn } from "@/lib/utils";

/** Initials from a name, falling back to the email's first letter. */
export function initials(name: string | null | undefined, email: string) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (email[0] ?? "?").toUpperCase();
}

export function Avatar({
  src, name, email, size = 36, className,
}: { src?: string | null; name?: string | null; email: string; size?: number; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- user-uploaded image from Supabase Storage
    <img src={src} alt="" width={size} height={size}
      className={cn("shrink-0 rounded-full object-cover ring-1 ring-border", className)}
      style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#F2701E] to-[#E8452C] font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name, email)}
    </span>
  );
}
