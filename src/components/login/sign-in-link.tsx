"use client";

/** Nav "Sign In": scrolls the sign-in card into view and puts the cursor in the email field. */
export function SignInLink({ className, children }: { className?: string; children: React.ReactNode }) {
  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    const input = document.getElementById("email") as HTMLInputElement | null;
    if (!input) return; // fall back to the plain #signin anchor
    e.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("signin")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    input.focus({ preventScroll: true });
  }
  return <a href="#signin" onClick={onClick} className={className}>{children}</a>;
}
