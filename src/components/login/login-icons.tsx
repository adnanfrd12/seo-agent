/** Small decorative product icons used on the sign-in page only. All aria-hidden. */

export function SearchConsoleIcon({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect x="3" y="5" width="28" height="22" rx="4" fill="#4285F4" />
      <rect x="7" y="9" width="20" height="3" rx="1.5" fill="#fff" opacity=".85" />
      <circle cx="25" cy="25" r="8" fill="#fff" stroke="#34A853" strokeWidth="3.5" />
      <path d="m30.5 30.5 5 5" stroke="#34A853" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function BingIcon({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id="li-bing" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#37BDFF" />
          <stop offset="1" stopColor="#0B8A8F" />
        </linearGradient>
      </defs>
      <path d="M9 4l7 2.5v21.6l9.6-5.6-4.7-2.2-2.9-7.1L31 17.6v8.7L16 35 9 31z" fill="url(#li-bing)" />
    </svg>
  );
}

export function ClarityIcon({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <circle cx="20" cy="20" r="16" fill="#EEF0FF" />
      <path d="M11 26 20 10l9 16" fill="none" stroke="#5B5FEF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 21h11" stroke="#41A5EE" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}
