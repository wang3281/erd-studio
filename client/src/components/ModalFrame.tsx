import { useEffect, useRef, type ReactNode } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { applyInertToSiblings } from "../hooks/inertSiblings";

interface ModalFrameProps {
  ariaLabelledBy: string;
  ariaDescribedBy?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

export function ModalFrame({
  ariaLabelledBy,
  ariaDescribedBy,
  className,
  onClose,
  children,
}: ModalFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, onClose);

  // 모달이 열린 동안 배경 콘텐츠를 inert 처리 (포커스/스크린리더 누출 방지)
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    return applyInertToSiblings(overlay);
  }, []);

  const classes = ["modal", className].filter(Boolean).join(" ");

  return (
    <div ref={overlayRef} className="modal-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <div
        ref={containerRef}
        className={classes}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
