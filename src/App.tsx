import React, { useEffect, useMemo, useRef, useState } from "react";

// ========================= Types & Consts =========================
export type Item = {
  id: string;
  text: string;
  checked: boolean;
  _selected?: boolean;
  _checkedAt?: number;
};
export type State = { edit: boolean; items: Item[] };

const STORAGE_KEY = "shopping_list_v1_react";
const HISTORY_LIMIT = 10;
const ROW_SPACING = 6; // px between rows
const DRAG_START_PX =
  navigator.maxTouchPoints || "ontouchstart" in window ? 2 : 6;

// ---- Haptics（音なし・バイブ専用） ----
const vibrateSafe = (p: number | number[]) => {
  try {
    if ("vibrate" in navigator) {
      const ok = (navigator as any).vibrate(p as any);
      return !!ok || ok === undefined;
    }
  } catch {}
  return false;
};
// ユーザー操作直下で直接 vibrate を叩く
const vibrateNow = (p: number | number[]) => {
  try {
    if ("vibrate" in navigator) {
      (navigator as any).vibrate(p as any);
    }
  } catch {}
};

// --- Haptics priming (Android Chromeでの発火率を上げる) ---
const hapticsPrimedRef: { current: boolean } = { current: false };
const primeHaptics = () => {
  if (hapticsPrimedRef.current) return;
  const ok = vibrateSafe(1) || vibrateSafe([1]) || vibrateSafe([10, 10, 10]);
  if (ok) hapticsPrimedRef.current = true;
};

const uid = () => Math.random().toString(36).slice(2, 9);

// 未チェック→先頭、チェックは _checkedAt の **古い順（昇順）** で下に積む（新しいほど下）
function sortUncheckedFirst(items: Item[]) {
  const a: Item[] = [],
    b: Item[] = [];
  for (const it of items) (it.checked ? b : a).push(it);
  b.sort((x, y) => (x._checkedAt ?? 0) - (y._checkedAt ?? 0));
  return a.concat(b);
}

function reorderByInsert(
  items: Item[],
  draggingIds: string[],
  insertAt: number
) {
  const moving = items.filter((i) => draggingIds.includes(i.id));
  const rest = items.filter((i) => !draggingIds.includes(i.id));
  const pos = Math.max(0, Math.min(insertAt, rest.length));
  return [...rest.slice(0, pos), ...moving, ...rest.slice(pos)];
}

function reorderAndUncheck(
  items: Item[],
  draggingIds: string[],
  insertAt: number
) {
  const moved = new Set(draggingIds);
  return reorderByInsert(items, draggingIds, insertAt).map((it) =>
    moved.has(it.id) ? { ...it, checked: false, _selected: false } : it
  );
}

// ---- paste helper (pure) ----
export function pasteMerge(original: string, cursor: number, pasted: string) {
  // FIX: unterminated regex → 正しい改行分割（CRLF/ LF）
  const lines = pasted.split(/\r?\n/).filter((l) => l.length > 0); // skip blank lines, keep bullets
  if (!lines.length) return { first: original, rest: [] as string[] };
  const before = original.slice(0, cursor);
  const after = original.slice(cursor);
  return { first: before + lines[0] + after, rest: lines.slice(1) };
}

// ========================= Persist + History =========================
function usePersistentState(initial: State) {
  const [state, setState] = useState<State>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as State) : initial;
    } catch {
      return initial;
    }
  });

  const historyRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);

  const pushHistory = (s: State) => {
    historyRef.current.push(JSON.stringify(s));
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    redoRef.current.length = 0;
  };

  const undo = () => {
    if (!historyRef.current.length) return;
    const cur = JSON.stringify(state);
    redoRef.current.push(cur);
    const prev = historyRef.current.pop()!;
    setState(JSON.parse(prev));
  };

  const redo = () => {
    if (!redoRef.current.length) return;
    const cur = JSON.stringify(state);
    historyRef.current.push(cur);
    const next = redoRef.current.pop()!;
    setState(JSON.parse(next));
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // expose for paste-merge
  useEffect(() => {
    (window as any).__setAppState = (s: State) => setState(s);
    (window as any).__getAppState = () => state;
    return () => {
      delete (window as any).__setAppState;
      delete (window as any).__getAppState;
    };
  }, [state]);

  return { state, setState, pushHistory, undo, redo } as const;
}

// ========================= App =========================
export default function App() {
  const { state, setState, pushHistory, undo, redo } = usePersistentState({
    edit: true,
    items: [{ id: uid(), text: "", checked: false }],
  });

  const listRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<null | {
    draggingIds: string[];
    offsetY: number;
    startX: number;
    startY: number;
    lastY: number;
    started: boolean;
    totalH: number;
  }>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const clickSuppressRef = useRef<((e: MouseEvent) => void) | null>(null);

  // 表示順
  const displayItems = useMemo(() => sortUncheckedFirst(state.items), [state]);

  // ---- typing session (for Undo/Redo unit) ----
  const typingRef = useRef<{ active: boolean }>({ active: false });
  const beginTypingIfNeeded = () => {
    if (!typingRef.current.active) {
      pushHistory(state);
      typingRef.current.active = true;
    }
  };
  const endTyping = () => {
    typingRef.current.active = false;
  };

  // remove blank items when leaving edit
  useEffect(() => {
    if (!state.edit) {
      const cleaned = state.items.filter((it) => it.text.trim() !== "");
      if (cleaned.length !== state.items.length)
        setState({ edit: state.edit, items: cleaned });
    }
  }, [state.edit]);

  // ソフトキーボード余白（全体スクロールは無し）
  useEffect(() => {
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    const apply = () => {
      const pad = vv ? Math.max(0, window.innerHeight - vv.height) : 0;
      document.documentElement.style.setProperty("--kbd-pad", pad + "px");
    };
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    apply();
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  // 画面全体スクロール抑止
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // 全チェック背景画像プリロード（5枚すべて）＋非同期デコード＆readyセット
  useEffect(() => {
    document.body.style.overflowX = "hidden";
    return () => {
      document.body.style.overflowX = "";
    };
  }, []);

  // ========================= Row ops =========================
  const setItemText = (index: number, text: string) => {
    const id = displayItems[index]?.id;
    if (!id) return;
    beginTypingIfNeeded();
    setState(({ items, edit }) => ({
      edit,
      items: items.map((it) => (it.id === id ? { ...it, text } : it)),
    }));
  };

  const toggleCheckedById = (id: string) => {
    if (state.edit) return; // 非編集モードのみ
    const nextItems = state.items.map((it) => {
      if (it.id !== id) return it;
      if (it.checked) return { ...it, checked: false, _checkedAt: undefined };
      return { ...it, checked: true, _checkedAt: Date.now() };
    });
    const willAllChecked =
      nextItems.length > 0 && nextItems.every((it) => it.checked);
    // チェック: 1ms、全チェック完了: 50-50-50ms、その他なし
    vibrateNow(1);
    if (willAllChecked) {
      vibrateNow([50, 50, 50]);
    }

    pushHistory(state);
    setState(({ edit }) => ({ edit, items: nextItems }));
  };

  const toggleSelected = (index: number, v: boolean) => {
    if (!state.edit) return;
    const id = displayItems[index]?.id;
    if (!id) return;
    pushHistory(state);
    setState(({ items, edit }) => ({
      edit,
      items: items.map((it) => (it.id === id ? { ...it, _selected: v } : it)),
    }));
  };

  const insertEmptyAfter = (index: number) => {
    if (!state.edit) return;
    const id = displayItems[index]?.id;
    if (!id) return;
    pushHistory(state);
    setState(({ items, edit }) => {
      const pos = items.findIndex((it) => it.id === id);
      if (pos < 0) return { edit, items };
      const next = [...items];
      const newItem = { id: uid(), text: "", checked: false };
      next.splice(pos + 1, 0, newItem);
      setTimeout(() => {
        const ta = document.querySelector(
          `.row[data-id="${newItem.id}"] textarea`
        ) as HTMLTextAreaElement | null;
        ta?.focus();
        ta?.setSelectionRange(0, 0);
      }, 0);
      return { edit, items: next };
    });
  };

  const deleteItem = (id: string) => {
    if (!state.edit) return;
    pushHistory(state);
    setState(({ items, edit }) => ({
      edit,
      items: items.filter((it) => it.id !== id),
    }));
  };

  // Reset（二段階）
  const [resetArmed, setResetArmed] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const ARM_TIMEOUT_MS = 5000;
  const armReset = () => {
    setResetArmed(true);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(
      () => setResetArmed(false),
      ARM_TIMEOUT_MS
    );
  };
  const doReset = () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    pushHistory(state);
    setState({ edit: true, items: [{ id: uid(), text: "", checked: false }] });
    setResetArmed(false);
  };
  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  // ========================= DnD（安定版） =========================
  const onPointerDownHandle = (
    e: React.PointerEvent<HTMLElement>,
    index: number,
    suppressDefault: boolean = true
  ) => {
    if (!state.edit) return;
    if (suppressDefault) {
      e.preventDefault();
      e.stopPropagation();
    }
    try {
      (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    } catch {}
    (document.activeElement as HTMLElement | null)?.blur?.();

    const list = listRef.current;
    if (!list) return;
    const pressed = displayItems[index];
    if (!pressed || pressed.checked) return;

    const selectedIds = state.items
      .filter((it) => it._selected && !it.checked)
      .map((it) => it.id);
    const draggingIds =
      pressed._selected && selectedIds.length > 1 ? selectedIds : [pressed.id];

    const rowEls = Array.from(list.children).filter(
      (el) =>
        (el as HTMLElement)?.dataset?.id &&
        draggingIds.includes(((el as HTMLElement).dataset!.id as string) || "")
    ) as HTMLElement[];
    if (!rowEls.length) return;

    const rect0 = rowEls[0].getBoundingClientRect();
    dragRef.current = {
      draggingIds,
      offsetY: e.clientY - rect0.top,
      startX: e.clientX,
      startY: e.clientY,
      lastY: e.clientY,
      started: false,
      totalH: 0,
    };

    window.addEventListener("pointermove", onPointerMove as any, {
      passive: false,
    });
    window.addEventListener("pointerup", onPointerUp as any, { once: true });
    window.addEventListener("pointercancel", onPointerCancel as any, {
      once: true,
    });

    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      if (!dragRef.current?.started && listRef.current)
        startDrag(listRef.current, e.clientY);
    }, 120);

    clickSuppressRef.current = (evt: MouseEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
    };
    window.addEventListener("click", clickSuppressRef.current, true);
  };

  function startDrag(list: HTMLDivElement, clientY: number) {
    if (!dragRef.current || dragRef.current.started) return;
    const { draggingIds, offsetY } = dragRef.current;

    const rowEls = Array.from(list.children).filter(
      (el) =>
        (el as HTMLElement)?.dataset?.id &&
        draggingIds.includes(((el as HTMLElement).dataset!.id as string) || "")
    ) as HTMLElement[];
    if (!rowEls.length) return;

    const sumHeights = rowEls.reduce(
      (sum, r) => sum + r.getBoundingClientRect().height,
      0
    );
    const internalSpacing = Math.max(0, rowEls.length - 1) * ROW_SPACING;
    const totalH = sumHeights + internalSpacing;

    const ghost = document.createElement("div");
    ghost.className = "ghost";
    ghost.style.position = "fixed";
    ghost.style.left = "8px";
    ghost.style.top = "0";
    ghost.style.zIndex = "9999";
    ghost.style.pointerEvents = "none";
    ghost.style.width =
      Math.min(520, list.getBoundingClientRect().width) + "px";
    ghost.style.height = Math.max(40, totalH) + "px";
    ghost.style.opacity = "1";
    ghost.style.background = "#fff";
    ghost.style.borderRadius = "12px";
    ghost.style.boxShadow = "0 8px 24px rgba(0,0,0,.12)";
    const frag = document.createDocumentFragment();
    rowEls.forEach((r, idx) => {
      const clone = r.cloneNode(true) as HTMLElement;
      clone.style.pointerEvents = "none";
      clone.style.marginTop = idx === 0 ? "0px" : `${ROW_SPACING}px`;
      frag.appendChild(clone);
    });
    ghost.appendChild(frag);
    document.body.appendChild(ghost);
    ghostRef.current = ghost;

    // collapse originals during drag
    rowEls.forEach((r) => {
      r.setAttribute("data-drag-collapsed", "1");
      (r as HTMLElement).style.display = "none";
    });

    const ph = document.createElement("div");
    (ph as any).dataset.placeholder = "1";
    ph.style.height = "0px";
    ph.style.margin = "0";
    ph.style.pointerEvents = "none";
    list.insertBefore(ph, rowEls[0] as Element);

    updatePlaceholder(list, clientY, draggingIds, totalH);
    const y = clientY - offsetY;
    ghost.style.transform = `translate3d(0, ${y}px, 0)`;

    dragRef.current.started = true;
    dragRef.current.totalH = totalH;
  }

  const onPointerMove = (ev: PointerEvent) => {
    if (!dragRef.current || !listRef.current) return;
    const { startX, startY, started, offsetY, draggingIds, totalH } =
      dragRef.current;
    const dx = Math.abs(ev.clientX - startX),
      dy = Math.abs(ev.clientY - startY);
    if (!started && Math.max(dx, dy) < DRAG_START_PX) return;
    if (!started) startDrag(listRef.current, ev.clientY);

    ev.preventDefault();
    if (ghostRef.current)
      ghostRef.current.style.transform = `translate3d(0, ${
        ev.clientY - offsetY
      }px, 0)`;

    if (wrapRef.current) {
      const edge = 50;
      const rect = wrapRef.current.getBoundingClientRect();
      if (ev.clientY < rect.top + edge) wrapRef.current.scrollTop -= 12;
      if (ev.clientY > rect.bottom - edge) wrapRef.current.scrollTop += 12;
    }

    updatePlaceholder(listRef.current, ev.clientY, draggingIds, totalH);
    if (dragRef.current) dragRef.current.lastY = ev.clientY;
  };

  const onPointerUp = (_ev: PointerEvent) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (clickSuppressRef.current) {
      window.removeEventListener("click", clickSuppressRef.current, true);
      clickSuppressRef.current = null;
    }
    window.removeEventListener("pointermove", onPointerMove as any);

    const started = !!dragRef.current?.started;
    const list = listRef.current;
    if (!started) {
      const ph = list?.querySelector(
        '[data-placeholder="1"]'
      ) as HTMLDivElement | null;
      if (ph) ph.remove();
      list?.querySelectorAll('[data-drag-collapsed="1"]').forEach((el) => {
        (el as HTMLElement).style.display = "flex";
        el.removeAttribute("data-drag-collapsed");
      });
      dragRef.current = null;
      return;
    }

    const draggingIds = dragRef.current?.draggingIds || [];
    ghostRef.current?.remove();
    ghostRef.current = null;
    if (!list || !draggingIds.length) {
      dragRef.current = null;
      return;
    }

    const { insertAt } = finalizePlaceholder(list, draggingIds);

    const cleanup = () => {
      requestAnimationFrame(() => {
        const l = listRef.current;
        if (!l) return;
        const ph2 = l.querySelector(
          '[data-placeholder="1"]'
        ) as HTMLDivElement | null;
        if (ph2) ph2.remove();
        l.querySelectorAll('[data-drag-collapsed="1"]').forEach((el) => {
          (el as HTMLElement).style.display = "flex";
          el.removeAttribute("data-drag-collapsed");
        });
      });
    };

    dragRef.current = null;

    if (insertAt == null) {
      cleanup();
      return;
    }

    pushHistory(state);
    setState(({ items, edit }) => ({
      edit,
      items: reorderAndUncheck(items, draggingIds, insertAt),
    }));
    cleanup();
  };

  const onPointerCancel = (_ev: PointerEvent) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (clickSuppressRef.current) {
      window.removeEventListener("click", clickSuppressRef.current, true);
      clickSuppressRef.current = null;
    }
    window.removeEventListener("pointermove", onPointerMove as any);
    ghostRef.current?.remove();
    ghostRef.current = null;
    const list = listRef.current;
    const ph = list?.querySelector(
      '[data-placeholder="1"]'
    ) as HTMLDivElement | null;
    if (ph) ph.remove();
    list?.querySelectorAll('[data-drag-collapsed="1"]').forEach((el) => {
      (el as HTMLElement).style.display = "flex";
      el.removeAttribute("data-drag-collapsed");
    });
    dragRef.current = null;
  };

  function updatePlaceholder(
    list: HTMLDivElement,
    clientY: number,
    draggingIds: string[],
    totalH: number
  ) {
    const ph = list.querySelector(
      '[data-placeholder="1"]'
    ) as HTMLDivElement | null;
    if (!ph) return;
    const children = Array.from(list.children).filter((el) => {
      const he = el as HTMLElement;
      const ds: any = he.dataset ?? {};
      const isPh = ds.placeholder === "1";
      const isCollapsed =
        ds.dragCollapsed === "1" || he.style.display === "none";
      return !isPh && !isCollapsed;
    });

    // 下方向ドラッグ時：1アイテム分のスペースが空いたら繰上げ（グループ平均行高）
    const dr = dragRef.current;
    const topY = clientY - (dr?.offsetY ?? 0);
    const prevY = dr?.lastY ?? dr?.startY ?? clientY;
    const draggingDown = clientY >= prevY;
    const unitH = (() => {
      const n = Math.max(1, draggingIds.length);
      const avg = Math.max(1, Math.round((dr?.totalH ?? totalH) / n));
      return isFinite(avg) && avg > 1 ? avg : 28;
    })();

    let targetIndex = 0;
    for (let i = 0; i < children.length; i++) {
      const he = children[i] as HTMLElement;
      const id = he.dataset?.id || "";
      const rect = he.getBoundingClientRect();
      const isChecked = he.dataset?.checked === "1"; // fixed rows (edit)
      if (draggingIds.includes(id) || isChecked) continue;
      const threshold = draggingDown ? rect.top : rect.top + rect.height / 2;
      const probe = draggingDown
        ? topY + (dr?.totalH ?? totalH) - Math.min(rect.height, unitH)
        : clientY;
      if (probe > threshold) targetIndex = i + 1;
    }

    const ref = children[targetIndex] as HTMLElement | undefined;
    const phH = Math.max(28, totalH - ROW_SPACING);
    ph.style.height = `${phH}px`;
    ph.style.marginTop = targetIndex === 0 ? "0px" : `${ROW_SPACING}px`;
    ph.style.marginBottom = ref ? `${ROW_SPACING}px` : "0px";
    if (ref) list.insertBefore(ph, ref);
    else list.appendChild(ph);
  }

  function finalizePlaceholder(list: HTMLDivElement, draggingIds: string[]) {
    const ph = list.querySelector(
      '[data-placeholder="1"]'
    ) as HTMLDivElement | null;
    if (!ph) return { insertAt: null as number | null };
    const all = Array.from(list.children);
    const phPos = all.indexOf(ph);
    const insertAt = all.slice(0, phPos).filter((el) => {
      const he = el as HTMLElement;
      const id = he.dataset?.id || "";
      const isPh = he.dataset?.placeholder === "1";
      const isCollapsed =
        he.dataset?.dragCollapsed === "1" ||
        (he as HTMLElement).style.display === "none";
      const isChecked = he.dataset?.checked === "1"; // fixed rows (edit)
      return !isPh && !isCollapsed && !isChecked && !draggingIds.includes(id);
    }).length;
    return { insertAt };
  }

  // ========================= Render =========================
  // color rule: blue only when NON-EDIT mode and all checked
  const allCheckedBlue =
    !state.edit &&
    state.items.length > 0 &&
    state.items.every((it) => it.checked);

  // Run pure-function tests once (log only)
  useEffect(() => {
    const r = runTests();
    if (r.failed) console.warn("[Tests] Failed:", r.failures);
  }, []);

  return (
    <div
      style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh" }}
      onPointerDown={() => {
        primeHaptics();
      }}
      onMouseDown={() => {
        primeHaptics();
      }}
      onTouchStart={() => {
        primeHaptics();
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 3,
          display: "flex",
          gap: 6,
          alignItems: "center",
          padding: 6,
          background: "#fff",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {/* Reset (leftmost). Two-step: icon -> red Reset */}
          <button
            onClick={() => {
              primeHaptics();
              resetArmed ? doReset() : armReset();
            }}
            onBlur={() => setResetArmed(false)}
            title={resetArmed ? "Reset 実行" : "全消去（確認付き）"}
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              border: "1px solid #e5e7eb",
              background: resetArmed ? "#ef4444" : "#fff",
              color: resetArmed ? "#fff" : "#111",
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            {resetArmed ? "Reset" : "⟲"}
          </button>
          {/* Undo */}
          <button
            onClick={() => {
              primeHaptics();
              undo();
            }}
            title="元に戻す"
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontSize: 18,
            }}
          >
            ↶
          </button>
          {/* Redo */}
          <button
            onClick={() => {
              primeHaptics();
              redo();
            }}
            title="やり直す"
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontSize: 18,
            }}
          >
            ↷
          </button>
          {/* Edit (rightmost) */}
          <button
            onClick={() => {
              primeHaptics();
              endTyping();
              setState((s) => ({ edit: !s.edit, items: s.items }));
            }}
            aria-pressed={state.edit}
            title={state.edit ? "編集モード（ON）" : "編集モード（OFF）"}
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              border: "1px solid #e5e7eb",
              background: state.edit ? "#16a34a" : "#fff",
              color: state.edit ? "#fff" : "#111",
              fontSize: 18,
            }}
          >
            ✏︎
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        style={{
          overflow: "auto",
          padding: 12,
          paddingBottom: "calc(16px + var(--kbd-pad))",
          backgroundImage: allCheckedBlue
            ? "linear-gradient(180deg, rgba(147,197,253,0.30), rgba(147,197,253,0.18))"
            : undefined,
        }}
      >
        <div
          ref={listRef}
          style={{ display: "flex", flexDirection: "column", gap: 0 }}
        >
          {displayItems.map((item, i) => (
            <Row
              key={item.id}
              item={item}
              index={i}
              edit={state.edit}
              onInput={(t) => setItemText(i, t)}
              onEnter={() => {
                endTyping();
                insertEmptyAfter(i);
              }}
              onToggleChecked={() => toggleCheckedById(item.id)}
              onToggleSelected={(v) => toggleSelected(i, v)}
              onDelete={() => {
                endTyping();
                deleteItem(item.id);
              }}
              onPointerDownHandle={(e) => {
                endTyping();
                onPointerDownHandle(e, i, true);
              }}
              allCheckedBlue={allCheckedBlue}
            />
          ))}
        </div>
      </div>

      {/* Buttons Area（固定／画面最下部） */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 8,
          padding: 8,
          paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
          borderTop: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <button
          onClick={() => {
            primeHaptics();
            resetArmed ? doReset() : armReset();
          }}
          onBlur={() => setResetArmed(false)}
          title={resetArmed ? "Reset 実行" : "全消去（確認付き）"}
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            border: "1px solid #e5e7eb",
            background: resetArmed ? "#ef4444" : "#fff",
            color: resetArmed ? "#fff" : "#111",
            fontWeight: 600,
            fontSize: 16,
          }}
        >
          {resetArmed ? "Reset" : "⟲"}
        </button>
        <button
          onClick={() => {
            primeHaptics();
            undo();
          }}
          title="元に戻す"
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            border: "1px solid #e5e7eb",
            background: "#fff",
            fontSize: 18,
          }}
        >
          ↶
        </button>
        <button
          onClick={() => {
            primeHaptics();
            redo();
          }}
          title="やり直す"
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            border: "1px solid #e5e7eb",
            background: "#fff",
            fontSize: 18,
          }}
        >
          ↷
        </button>
        <button
          onClick={() => {
            primeHaptics();
            endTyping();
            setState((s) => ({ edit: !s.edit, items: s.items }));
          }}
          aria-pressed={state.edit}
          title={state.edit ? "編集モード（ON）" : "編集モード（OFF）"}
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            border: "1px solid #e5e7eb",
            background: state.edit ? "#16a34a" : "#fff",
            color: state.edit ? "#fff" : "#111",
            fontSize: 18,
          }}
        >
          ✏︎
        </button>
      </div>
    </div>
  );
}

function Row(props: {
  item: Item;
  index: number;
  edit: boolean;
  onInput: (text: string, ta?: HTMLTextAreaElement) => void;
  onEnter: () => void;
  onToggleChecked: () => void;
  onToggleSelected: (v: boolean) => void;
  onDelete: () => void;
  onPointerDownHandle: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerDownFromSelect?: (e: React.PointerEvent<HTMLElement>) => void;
  allCheckedBlue: boolean;
}) {
  const { item, index, edit, allCheckedBlue } = props;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // 固定行高に合わせる（自己伸長はしない・垂直中央）
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const MIN = 24; // 1行分の高さ
    ta.style.padding = "0"; // UAデフォルトの内側余白を打ち消す
    ta.style.height = "0px"; // 再計測
    const h = Math.max(
      MIN,
      Math.min(ta.scrollHeight, window.innerHeight * 0.35)
    );
    ta.style.height = h + "px";
  }, [item.text, edit]);

  // backgrounds:
  // - non-edit & all checked: blue (濃いめ)
  // - checked item: darker gray
  const bgColor = allCheckedBlue
    ? "#93c5fd"
    : item.checked
    ? "#cbd5e1"
    : "#fff";

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    flexWrap: "nowrap",
    marginTop: index === 0 ? 0 : ROW_SPACING,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "6px 16px",
    gap: 6,
    width: "100%",
    background: bgColor,
    boxSizing: "border-box",
    touchAction: "none",
  };

  if (edit && item.checked) {
    return (
      <div
        className="row"
        data-id={item.id}
        data-index={index}
        data-checked="1"
        style={rowStyle}
      >
        <textarea
          ref={taRef}
          value={item.text}
          readOnly
          spellCheck={false}
          onBlur={() => props.onEndTyping()}
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            color: "#777",
            textDecoration: "line-through",
            padding: "0",
            fontSize: 16,
            lineHeight: "24px",
            minHeight: "24px",
            alignSelf: "center",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="row"
      data-id={item.id}
      data-index={index}
      style={rowStyle}
      onClick={
        !edit
          ? () => {
              primeHaptics();
              props.onToggleChecked();
            }
          : undefined
      }
    >
      {edit && (
        <button
          type="button"
          title="この行を削除"
          aria-label="この行を削除"
          onClick={(e) => {
            e.stopPropagation();
            primeHaptics();
            props.onDelete();
          }}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            fontSize: 14,
          }}
        >
          ✖
        </button>
      )}
      <textarea
        ref={taRef}
        value={item.text}
        readOnly={!edit}
        onInput={(e) =>
          props.onInput(
            (e.target as HTMLTextAreaElement).value,
            e.currentTarget
          )
        }
        onKeyDown={(e) => {
          if (edit && e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            props.onEndTyping();
            props.onEnter();
          }
        }}
        onPaste={(e) => {
          if (!edit) return;
          const data = e.clipboardData || (window as any).clipboardData;
          const text = data?.getData?.("text") ?? "";
          if (!text || !text.includes("\n")) return; // single-line: default
          e.preventDefault();
          const ta = e.currentTarget as HTMLTextAreaElement;
          const pos = ta.selectionStart ?? ta.value.length;
          const { first, rest } = pasteMerge(ta.value, pos, text);
          props.onInput(first, ta);
          try {
            const appSet = (window as any).__setAppState;
            const appGet = (window as any).__getAppState;
            if (appSet && appGet) {
              const s: State = appGet();
              const row = ta.closest(".row") as HTMLElement | null;
              const id = row?.getAttribute("data-id") || "";
              const idx = s.items.findIndex((it: Item) => it.id === id);
              if (idx < 0) return;
              const inserts = rest.map((l: string) => ({
                id: uid(),
                text: l,
                checked: false,
              }));
              const next = [...s.items];
              next[idx] = { ...next[idx], text: first };
              if (inserts.length) next.splice(idx + 1, 0, ...inserts);
              appSet({ edit: s.edit, items: next });
              setTimeout(() => {
                const lastId = inserts.length
                  ? inserts[inserts.length - 1].id
                  : next[idx].id;
                const focusTa = document.querySelector(
                  `.row[data-id="${lastId}"] textarea`
                ) as HTMLTextAreaElement | null;
                focusTa?.focus();
                focusTa?.setSelectionRange(
                  focusTa.value.length,
                  focusTa.value.length
                );
              }, 0);
            }
          } catch {}
        }}
        spellCheck={false}
        onBlur={() => props.onEndTyping()}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          resize: "none",
          background: "transparent",
          textDecoration: item.checked ? "line-through" : "none",
          padding: "0",
          fontSize: 16,
          lineHeight: "24px",
          minHeight: "24px",
          alignSelf: "center",
        }}
      />
      {edit && !item.checked && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          <input
            className="select"
            type="checkbox"
            checked={!!item._selected}
            onChange={(e) => props.onToggleSelected(e.target.checked)}
            onPointerDown={(e) => {
              primeHaptics();
              props.onPointerDownHandle(e);
            }}
            style={{ width: 20, height: 20 }}
          />
          <button
            className="handle"
            type="button"
            onPointerDown={(e) => {
              primeHaptics();
              props.onPointerDownHandle(e);
            }}
            title="ドラッグで並び替え"
            style={{
              width: 32,
              height: 28,
              borderRadius: 6,
              border: "1px dashed #d1d5db",
              display: "grid",
              placeItems: "center",
              fontSize: 14,
              color: "#6b7280",
              background: "#fff",
              touchAction: "none",
              flexShrink: 0,
            }}
          >
            ≡
          </button>
        </div>
      )}
    </div>
  );
}

// ========================= Pure-function Tests =========================
function runTests() {
  type T = { name: string; fn: () => void };
  const tests: T[] = [];

  tests.push({
    name: "reorderByInsert contiguous",
    fn: () => {
      const a = { id: "a", text: "a", checked: false } as Item;
      const b = { id: "b", text: "b", checked: false } as Item;
      const c = { id: "c", text: "c", checked: false } as Item;
      const d = { id: "d", text: "d", checked: false } as Item;
      const out = reorderByInsert([a, b, c, d], [b.id, c.id], 0);
      if (out.map((x) => x.id).join("") !== "bcad") throw new Error("wrong");
    },
  });

  tests.push({
    name: "reorderAndUncheck clears flags",
    fn: () => {
      const a = { id: "a", text: "a", checked: true, _selected: true } as Item;
      const b = { id: "b", text: "b", checked: false } as Item;
      const out = reorderAndUncheck([a, b], [a.id], 1);
      if (!(out[1].id === "a" && !out[1].checked && !out[1]._selected))
        throw new Error("flags not cleared");
    },
  });

  tests.push({
    name: "sortUncheckedFirst order",
    fn: () => {
      const a = { id: "a", text: "a", checked: true } as Item;
      const b = { id: "b", text: "b", checked: false } as Item;
      const out = sortUncheckedFirst([a, b]);
      if (out[0].id !== "b" || out[1].id !== "a") throw new Error("order");
    },
  });

  tests.push({
    name: "pasteMerge splits correctly",
    fn: () => {
      const original = "abCD";
      const cursor = 2;
      const pasted = "x\ny\n\nz";
      const { first, rest } = pasteMerge(original, cursor, pasted);
      if (first !== "abxCD") throw new Error("first");
      if (rest.join(",") !== "y,z") throw new Error("rest");
    },
  });

  // extra tests
  tests.push({
    name: "pasteMerge single line no rest",
    fn: () => {
      const { first, rest } = pasteMerge("aa", 1, "Z");
      if (first !== "aZa" || rest.length !== 0)
        throw new Error("single-line paste");
    },
  });

  tests.push({
    name: "reorderAndUncheck multi move",
    fn: () => {
      const x = (id: string) => ({ id, text: id, checked: false } as Item);
      const arr = [x("a"), x("b"), x("c"), x("d")];
      const out = reorderAndUncheck(arr, ["b", "c"], 3);
      if (out.map((o) => o.id).join("") !== "adbc")
        throw new Error("multi move order");
    },
  });

  // additional regression: CRLF paste
  tests.push({
    name: "pasteMerge CRLF",
    fn: () => {
      const { first, rest } = pasteMerge("foo", 3, "\r\nA\r\nB");
      if (first !== "foo") throw new Error("crlf first");
      if (rest.join("") !== "AB") throw new Error("crlf rest");
    },
  });

  // new: checked items stack by newest
  tests.push({
    name: "sortUncheckedFirst checked by _checkedAt desc",
    fn: () => {
      const u = { id: "u", text: "u", checked: false } as Item;
      const a = { id: "a", text: "a", checked: true, _checkedAt: 100 } as Item;
      const b = { id: "b", text: "b", checked: true, _checkedAt: 200 } as Item;
      const out = sortUncheckedFirst([a, u, b]);
      if (out.map((o) => o.id).join("") !== "ubu a".replace(/\s/g, ""))
        throw new Error("checked order by time");
    },
  });

  let passed = 0,
    failed = 0;
  const failures: string[] = [];
  for (const t of tests) {
    try {
      t.fn();
      passed++;
    } catch (e: any) {
      failed++;
      failures.push(`${t.name}: ${e?.message || e}`);
    }
  }
  return { passed, failed, failures };
}
