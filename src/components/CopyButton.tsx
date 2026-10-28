import { useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";
import { cx } from "./ui";

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked; nothing useful to do */
        }
      }}
      className={cx(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-xl transition cursor-pointer",
        copied ? "text-brand" : "text-subtle hover:bg-sunken hover:text-ink",
        className,
      )}
    >
      {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
    </button>
  );
}
