import { useEffect, useRef } from "react";

interface AutoTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  className?: string;
}

/**
 * A textarea that grows with its content instead of staying a fixed small
 * size — used for fields like request bodies and pasted headers, where a
 * cramped fixed-height box makes anything beyond a couple of lines awkward
 * to read or edit.
 */
export default function AutoTextarea({ value, onChange, placeholder, minRows = 4, className }: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={className}
      rows={minRows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ overflow: "hidden", resize: "vertical" }}
    />
  );
}
