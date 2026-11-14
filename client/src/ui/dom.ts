// Tiny DOM helpers. The UI is hand-built DOM (no framework) so the build stays
// dependency-free and fast on ordinary desktop hardware.

import { playSfx } from "../game/audio";

type Props = {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  id?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  attrs?: Record<string, string | number | boolean | undefined>;
  on?: Partial<Record<keyof HTMLElementEventMap, (ev: Event) => void>>;
  dataset?: Record<string, string>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.id) node.id = props.id;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.title) node.title = props.title;
  if (props.style) {
    if (typeof props.style === "string") node.setAttribute("style", props.style);
    else Object.assign(node.style, props.style);
  }
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === undefined || v === false) continue;
      node.setAttribute(k, v === true ? "" : String(v));
    }
  }
  if (props.dataset) {
    for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;
  }
  if (props.on) {
    for (const [k, fn] of Object.entries(props.on)) {
      if (fn) node.addEventListener(k, fn as EventListener);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function button(label: string, cls: string, onClick: () => void, extra?: Props): HTMLButtonElement {
  const b = el("button", {
    class: `btn ${cls}`,
    text: label,
    ...extra,
    on: {
      click: () => {
        playSfx("ui");
        onClick();
      },
      ...(extra?.on ?? {}),
    },
  });
  b.type = "button";
  return b;
}

export function clear(node: HTMLElement) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function icon(name: string): HTMLSpanElement {
  const glyphs: Record<string, string> = {
    play: "▶",
    copy: "⧉",
    check: "✓",
    close: "✕",
    back: "←",
    net: "⇄",
    lock: "⌾",
    reset: "↺",
    pad: "◧",
    link: "⛓",
    users: "◉",
  };
  return el("span", { class: "ico", text: glyphs[name] ?? "•", attrs: { "aria-hidden": "true" } });
}

export function toast(msg: string, kind: "info" | "error" | "ok" = "info") {
  const host = document.getElementById("toasts") ?? document.body.appendChild(
    el("div", { id: "toasts", class: "toasts" })
  );
  const t = el("div", { class: `toast ${kind}`, text: msg });
  host.append(t);
  setTimeout(() => t.classList.add("out"), 2600);
  setTimeout(() => t.remove(), 3200);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = el("textarea", { style: "position:fixed;opacity:0", text });
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
