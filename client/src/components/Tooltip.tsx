import { useId, type ReactNode } from "react";

interface TooltipProps {
  label: string;
  shortcut?: string;
  children: ReactNode;
}

export function Tooltip({ label, shortcut, children }: TooltipProps) {
  const bubbleId = useId();
  return (
    <span className="tooltip">
      <span className="tooltip-target" aria-describedby={bubbleId}>{children}</span>
      <span className="tooltip-bubble" role="tooltip" id={bubbleId}>
        <span>{label}</span>
        {shortcut ? <span className="tooltip-shortcut">{shortcut}</span> : null}
      </span>
    </span>
  );
}
