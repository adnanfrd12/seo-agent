/** Google "G" in its four brand colors. */
export function GoogleG({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Google Analytics-style orange bars. */
export function AnalyticsIcon({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect x="4" y="22" width="9" height="14" rx="4.5" fill="#F9AB00" />
      <rect x="15.5" y="13" width="9" height="23" rx="4.5" fill="#F9AB00" />
      <rect x="27" y="3" width="9" height="33" rx="4.5" fill="#E37400" />
    </svg>
  );
}

/** Storefront in Business Profile blue. */
export function BusinessProfileIcon({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <path d="M5 14 8.5 6h23L35 14z" fill="#4285F4" />
      <path d="M5 14h30v3a5 5 0 0 1-10 0 5 5 0 0 1-10 0 5 5 0 0 1-10 0z" fill="#1A73E8" />
      <rect x="7" y="19" width="26" height="15" rx="1.5" fill="#4285F4" />
      <rect x="16" y="23" width="10" height="11" rx="1" fill="#fff" opacity=".9" />
    </svg>
  );
}
