"use client";
import { useEffect, useRef, useState } from "react";

// "Copy link" (roadmap 1.3, defect D4): one unobtrusive control that hands the
// client the URL of the view they are actually looking at, read at click time.
//
// Clipboard access needs a secure context and can be rejected. When it is
// missing or refused we do NOT claim success: the fallback reveals the URL in a
// selectable input so the user can copy it by hand, and the live region says so
// instead of pretending.
export default function ShareLink({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const onCopy = async () => {
    const url = window.location.href;
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(url);
      setManualUrl(null);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setManualUrl(url);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={onCopy}
        className="min-w-[7rem] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
      >
        {copied ? "Copied ✓" : "Copy link"}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied
          ? "Link copied to clipboard"
          : manualUrl
            ? "Clipboard unavailable — select the link shown to copy it"
            : ""}
      </span>
      {manualUrl && (
        <input
          readOnly
          value={manualUrl}
          aria-label="Link to this view — select and copy"
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
          className="w-64 max-w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
        />
      )}
    </div>
  );
}
