"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";

export type TabItem = {
  id: string;
  label: string;
  href: string;
  title?: string;
};

export function Tabs(props: {
  items: TabItem[];
  activeId: string;
  ariaLabel: string;
}) {
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  function focusTab(index: number) {
    const nextIndex = (index + props.items.length) % props.items.length;
    tabRefs.current[nextIndex]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLAnchorElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusTab(index + 1);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusTab(index - 1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusTab(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusTab(props.items.length - 1);
    }
  }

  return (
    <nav aria-label={props.ariaLabel} className="tabs" role="tablist">
      {props.items.map((item, index) => {
        const isActive = item.id === props.activeId;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            aria-selected={isActive}
            className={isActive ? "tabs-link tabs-link-active" : "tabs-link"}
            href={item.href}
            key={item.id}
            onKeyDown={(event) => handleKeyDown(index, event)}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            title={item.title ?? item.label}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
