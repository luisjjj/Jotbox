import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  value,
  options,
  onChange,
  id,
  disabled = false,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const placeMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 184), window.innerWidth - 16);
    const height = Math.min(options.length * 40 + 8, 264);
    const up = rect.bottom + height + 8 > window.innerHeight && rect.top > height + 8;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setPos({ left, top: up ? rect.top - height - 6 : rect.bottom + 6, width });
  };

  const openMenu = () => {
    if (disabled) return;
    setActive(selectedIndex);
    placeMenu();
    setOpen(true);
  };

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const move = (direction: 1 | -1) => {
    setActive((current) => {
      let next = current;
      for (let step = 0; step < options.length; step += 1) {
        next = (next + direction + options.length) % options.length;
        if (!options[next].disabled) return next;
      }
      return current;
    });
  };

  const edge = (side: "first" | "last") => {
    const indexes = options.map((_, index) => index);
    if (side === "last") indexes.reverse();
    const next = indexes.find((index) => !options[index].disabled);
    if (next !== undefined) setActive(next);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      edge("first");
    } else if (event.key === "End") {
      event.preventDefault();
      edge("last");
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={clsx(
          "field flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
      >
        <span className="min-w-0 truncate">{selected?.label ?? ""}</span>
        <ChevronDown
          className={clsx("h-4 w-4 flex-none text-faint transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className="fixed z-[90] max-h-[16.5rem] overflow-y-auto rounded-xl border border-line bg-raised p-1 shadow-float outline-none"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
            onKeyDown={onMenuKeyDown}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] transition-colors",
                    option.disabled
                      ? "cursor-not-allowed text-faint opacity-60"
                      : index === active
                        ? "bg-accent-soft text-ink"
                        : "text-soft hover:bg-raised-2 hover:text-ink",
                  )}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 flex-none text-accent" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
