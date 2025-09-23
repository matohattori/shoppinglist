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
const vibrateNow = (p: number | number[]) => {
  try {
    if ("vibrate" in navigator) {
      (navigator as any).vibrate(p as any);
    }
  } catch {}
};

const hapticsPrimedRef: { current: boolean } = { current: false };
const primeHaptics = () => {
  if (hapticsPrimedRef.current) return;
  const ok = vibrateSafe(1) || vibrateSafe([1]) || vibrateSafe([10, 10, 10]);
  if (ok) hapticsPrimedRef.current = true;
};

const uid = () => Math.random().toString(36).slice(2, 9);

function sortUncheckedFirst(items: Item[]) {
  const a: Item[] = [],
    b: Item[] = [];
  for (const it of items) (it.checked ? b : a).push(it);
  b.sort((x, y) => (y._checkedAt ?? 0) - (x._checkedAt ?? 0));
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

export function pasteMerge(original: string, cursor: number, pasted: string) {
  const lines = pasted.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return { first: original, rest: [] as string[] };
  const before = original.slice(0, cursor);
  const after = original.slice(cursor);
  return { first: before + lines[0] + after, rest: lines.slice(1) };
}

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

  return { state, setState, pushHistory, undo, redo } as const;
}

export default function App() {
  const { state, setState, pushHistory, undo, redo } = usePersistentState({
    edit: true,
    items: [{ id: uid(), text: "", checked: false }],
  });

  const listRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const displayItems = useMemo(() => sortUncheckedFirst(state.items), [state]);

  const stats = useMemo(() => {
    const valid = state.items.filter((it) => it.text.trim() !== "");
    const total = valid.length;
    const done = valid.filter((it) => it.checked).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { total, done, pct };
  }, [state.items]);

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

  useEffect(() => {
    if (!state.edit) {
      const cleaned = state.items.filter((it) => it.text.trim() !== "");
      if (cleaned.length !== state.items.length)
        setState({ edit: state.edit, items: cleaned });
    }
  }, [state.edit]);

  useEffect(() => {
    document.body.style.overflowX = "hidden";
    return () => {
      document.body.style.overflowX = "";
    };
  }, []);

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
    if (state.edit) return;
    const nextItems = state.items.map((it) => {
      if (it.id !== id) return it;
      if (it.checked) return { ...it, checked: false, _checkedAt: undefined };
      return { ...it, checked: true, _checkedAt: Date.now() };
    });
    const willAllChecked =
      nextItems.length > 0 && nextItems.every((it) => it.checked);
    vibrateNow(1);
    if (willAllChecked) {
      vibrateNow([50, 50, 50]);
    }
    pushHistory(state);
    setState(({ edit }) => ({ edit, items: nextItems }));
  };

  const deleteItem = (id: string) => {
    if (!state.edit) return;
    pushHistory(state);
    setState(({ items, edit }) => ({
      edit,
      items: items.filter((it) => it.id !== id),
    }));
  };

  const allCheckedBlue =
    !state.edit &&
    state.items.length > 0 &&
    state.items.every((it) => it.checked);

  return (
    <div
      style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh" }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 4,
          background: "#fff",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div style={{ padding: "10px 12px 8px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "flex-end",
              marginBottom: 6,
            }}
          >
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              {stats.done} / {stats.total} ({stats.pct}%)
            </div>
          </div>
          <div
            aria-label="progress"
            style={{
              height: 40,
              borderRadius: 999,
              background: "#f1f5f9",
              overflow: "hidden",
              boxShadow: "inset 0 0 0 1px #e5e7eb",
            }}
          >
            <div
              style={{
                width: `${stats.pct}%`,
                height: "100%",
                background: "linear-gradient(90deg,#dbeafe,#2563eb)",
                transition: "width .18s ease",
              }}
            />
          </div>
        </div>
      </div>
      <div
        ref={wrapRef}
        style={{
          overflow: "auto",
          padding: 12,
          paddingBottom: "calc(16px + var(--kbd-pad))",
          backgroundImage: allCheckedBlue
            ? "linear-gradient(180deg, rgba(37,99,235,0.30), rgba(37,99,235,0.18))"
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
              onToggleChecked={() => toggleCheckedById(item.id)}
              onDelete={() => deleteItem(item.id)}
              allCheckedBlue={allCheckedBlue}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row(props: {
  item: Item;
  index: number;
  edit: boolean;
  onInput: (text: string) => void;
  onToggleChecked: () => void;
  onDelete: () => void;
  allCheckedBlue: boolean;
}) {
  const { item, index, edit, allCheckedBlue } = props;
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const MIN = 24;
    ta.style.padding = "0";
    ta.style.height = "0px";
    const h = Math.max(
      MIN,
      Math.min(ta.scrollHeight, window.innerHeight * 0.35)
    );
    ta.style.height = h + "px";
  }, [item.text, edit]);

  const bgColor = allCheckedBlue
    ? "#2563eb"
    : item.checked
    ? "#cbd5e1"
    : "#fff";

  return (
    <div
      className="row"
      data-id={item.id}
      data-index={index}
      style={{
        display: "flex",
        alignItems: "center",
        marginTop: index === 0 ? 0 : ROW_SPACING,
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "6px 16px",
        gap: 6,
        width: "100%",
        background: bgColor,
      }}
      onClick={!edit ? props.onToggleChecked : undefined}
    >
      {edit && (
        <button
          type="button"
          title="削除"
          onClick={(e) => {
            e.stopPropagation();
            props.onDelete();
          }}
          style={{ width: 24, height: 24 }}
        >
          ✖
        </button>
      )}
      <textarea
        ref={taRef}
        value={item.text}
        readOnly={!edit}
        onInput={(e) => props.onInput((e.target as HTMLTextAreaElement).value)}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          resize: "none",
          background: "transparent",
          textDecoration: item.checked ? "line-through" : "none",
        }}
      />
    </div>
  );
}
