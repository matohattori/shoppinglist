// ===== src/App.tsx =====
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Reorder } from "framer-motion";
import { Check, Edit3, GripVertical, RotateCcw, Undo2 } from "lucide-react";

// ---------- utils ----------
const uuid = () => Math.random().toString(36).slice(2, 10);
const isBlank = (s: string) => s.trim().length === 0;
const hasLineBreak = (s: string) => typeof s === "string" && s.includes("\n");

function mergePaste(
  current: string,
  start: number,
  end: number,
  multiText: string
) {
  const txt = (multiText ?? "").replace(/\r\n?/g, "\n");
  const lines = txt.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return { merged: current, rest: [] as string[] };
  const before = current.slice(0, start);
  const after = current.slice(end);
  return { merged: before + lines[0] + after, rest: lines.slice(1) };
}

// ---------- component ----------
export default function App() {
  // 初期：空白1行、編集モードON
  const [items, setItems] = useState<
    { id: string; text: string; checked: boolean; selected: boolean }[]
  >([{ id: uuid(), text: "", checked: false, selected: false }]);
  const [editMode, setEditMode] = useState(true);
  const [confirmResetStep, setConfirmResetStep] = useState(0); // 0 or 1
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [kbOffset, setKbOffset] = useState(0); // キーボード分の縮小（px）

  const mainRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);

  // Undoスタック（編集モードのみ）
  const undoStack = useRef<(typeof items)[]>([]);
  const pushHistory = (prev: typeof items) => {
    undoStack.current.push(prev.map((i) => ({ ...i })));
    if (undoStack.current.length > 50) undoStack.current.shift();
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (prev) setItems(prev);
  };

  // ---- keyboard / viewport ----
  const getFooterHeight = () =>
    footerRef.current ? footerRef.current.getBoundingClientRect().height : 0;
  const computeKbOffset = () => {
    const vv = window.visualViewport;
    if (!vv) return 0;
    const bottomInset = Math.max(
      0,
      window.innerHeight - (vv.height + vv.offsetTop)
    );
    return Math.round(bottomInset);
  };

  useEffect(() => {
    try {
      // @ts-ignore experimental
      if (navigator.virtualKeyboard)
        navigator.virtualKeyboard.overlaysContent = true;
    } catch {}

    const vv = window.visualViewport;
    let lastInnerH = window.innerHeight;

    const handle = () => {
      const vvOffset = vv
        ? computeKbOffset()
        : Math.max(0, lastInnerH - window.innerHeight);
      setKbOffset(vvOffset);
      lastInnerH = window.innerHeight;
    };

    if (vv) {
      vv.addEventListener("resize", handle);
      vv.addEventListener("scroll", handle);
      handle();
      return () => {
        vv.removeEventListener("resize", handle);
        vv.removeEventListener("scroll", handle);
      };
    } else {
      window.addEventListener("resize", handle);
      handle();
      return () => {
        window.removeEventListener("resize", handle);
      };
    }
  }, []);

  // 入力要素を確実に可視化
  const ensureVisible = (el: HTMLInputElement | null) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vv = window.visualViewport;

    const pageTop = vv
      ? vv.pageTop
      : window.scrollY || document.documentElement.scrollTop || 0;
    const pageHeight = vv ? vv.height : window.innerHeight;
    const visibleTop = pageTop;
    const visibleBottom = pageTop + pageHeight;

    const padding = kbOffset + getFooterHeight() + 16; // 下端のバッファ
    const targetTop = visibleTop + 8;
    const targetBottom = visibleBottom - padding;

    const elTop = rect.top + pageTop - (vv ? vv.offsetTop : 0);
    const elBottom = rect.bottom + pageTop - (vv ? vv.offsetTop : 0);

    let dy = 0;
    if (elBottom > targetBottom) dy = elBottom - targetBottom;
    if (elTop < targetTop) dy = elTop - targetTop; // 上に隠れた場合（負値）

    if (dy !== 0) {
      const scroller = mainRef.current;
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 4) {
        scroller.scrollTo({ top: scroller.scrollTop + dy, behavior: "smooth" });
      } else {
        const se = document.scrollingElement || document.documentElement;
        window.scrollTo({
          top: (se.scrollTop || pageTop) + dy,
          behavior: "smooth",
        });
      }
    }
  };

  const focusMap = useRef<Record<string, HTMLInputElement | null>>({});
  const setInputRef = (id: string) => (el: HTMLInputElement | null) => {
    focusMap.current[id] = el;
  };
  const focusInput = (id: string) => {
    const el = focusMap.current[id];
    if (el) {
      setTimeout(() => {
        try {
          el.focus();
        } catch {}
        try {
          el.scrollIntoView({ block: "center" });
        } catch {}
        ensureVisible(el);
        const val = el.value ?? "";
        if (typeof el.setSelectionRange === "function")
          el.setSelectionRange(val.length, val.length);
      }, 0);
    }
  };

  // ---- editing helpers ----
  const addBelow = (index: number, preset = "") => {
    const prev = items;
    pushHistory(prev);
    const next: typeof items = [];
    prev.forEach((it, idx) => {
      next.push(it);
      if (idx === index) {
        const id = uuid();
        next.push({ id, text: preset, checked: false, selected: false });
        setTimeout(() => focusInput(id), 0);
      }
    });
    setItems(next);
  };

  const updateText = (id: string, text: string) => {
    setItems((p) => p.map((i) => (i.id === id ? { ...i, text } : i)));
  };

  const onKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    idx: number,
    id: string
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addBelow(idx);
    }
  };

  const onPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    idx: number,
    id: string
  ) => {
    const txt = e.clipboardData.getData("text");
    if (!txt || !hasLineBreak(txt)) return; // \n を含む時だけ特別処理
    e.preventDefault();

    const input = e.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;

    const { merged, rest } = mergePaste(input.value, start, end, txt);

    setItems((prev) => {
      const snapshot = prev.map((i) => ({ ...i }));
      pushHistory(snapshot);
      const updated = prev.map((i) =>
        i.id === id ? { ...i, text: merged } : i
      );
      if (rest.length > 0) {
        const insertAt = idx + 1;
        const newOnes = rest.map((t) => ({
          id: uuid(),
          text: t,
          checked: false,
          selected: false,
        }));
        return [
          ...updated.slice(0, insertAt),
          ...newOnes,
          ...updated.slice(insertAt),
        ];
      }
      return updated;
    });

    requestAnimationFrame(() => {
      const el = focusMap.current[id];
      if (el && typeof el.setSelectionRange === "function") {
        const pos = merged.length;
        try {
          el.setSelectionRange(pos, pos);
        } catch {}
        ensureVisible(el);
      }
    });
  };

  // ---- modes ----
  const toggleMode = () => {
    if (editMode) {
      const cleaned = items.filter((i) => !isBlank(i.text));
      setItems(cleaned.map((i) => ({ ...i, selected: false })));
      setConfirmResetStep(0);
    }
    setEditMode((v) => !v);
  };

  const toggleCheck = (id: string) => {
    if (editMode) return;
    setItems((prev) => {
      const next = prev.map((i) =>
        i.id === id ? { ...i, checked: !i.checked } : i
      );
      next.sort((a, b) => Number(a.checked) - Number(b.checked));
      return next;
    });
  };
  const toggleSelect = (id: string) => {
    if (!editMode) return;
    setItems((p) =>
      p.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i))
    );
  };

  // ---- reorder (group drag) ----
  const values = useMemo(() => items.map((i) => i.id), [items]);
  const onReorder = (newOrderIds: string[]) => {
    if (!editMode) return;

    const activeId = dragActiveId;
    if (!activeId) {
      setItems(
        newOrderIds
          .map((id) => items.find((x) => x!.id === id)!)
          .filter(Boolean) as typeof items
      );
      return;
    }

    const selectedIds = items.filter((i) => i.selected).map((i) => i.id);
    const isActiveSelected = selectedIds.includes(activeId);

    if (!isActiveSelected || selectedIds.length <= 1) {
      setItems(
        newOrderIds
          .map((id) => items.find((x) => x!.id === id)!)
          .filter(Boolean) as typeof items
      );
      return;
    }

    // activeが選択グループ内の最上でなければ無視
    const topMostSelected = items.find((i) => i.selected);
    const topMostSelectedId = topMostSelected ? topMostSelected.id : null;
    if (topMostSelectedId !== activeId) return;

    const targetIndex = newOrderIds.indexOf(activeId);
    if (targetIndex === -1) return;

    const remaining = items.filter((i) => !i.selected);
    const before = remaining.slice(0, targetIndex);
    const after = remaining.slice(targetIndex);
    const block = items.filter((i) => i.selected);
    setItems([...before, ...block, ...after]);
  };
  const onDragStart = (id: string) => setDragActiveId(id);
  const onDragEnd = () => setDragActiveId(null);

  // ---- reset ----
  const onReset = () => {
    if (confirmResetStep === 0) {
      setConfirmResetStep(1);
      return;
    }
    setItems([{ id: uuid(), text: "", checked: false, selected: false }]);
    setConfirmResetStep(0);
  };

  // ---- render ----
  return (
    <div
      className="min-h-[100dvh] flex flex-col bg-neutral-50 text-neutral-900"
      style={{
        paddingBottom: `calc(${kbOffset}px + env(safe-area-inset-bottom))`,
      }}
    >
      {/* header */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-neutral-200">
        <div className="mx-auto max-w-md px-4 py-3 flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">買い物チェックリスト</h1>
          <div className="flex items-center gap-2">
            {editMode && (
              <button
                className="px-2 py-1 rounded-xl border border-neutral-300 text-sm hover:bg-neutral-100 active:scale-[0.98]"
                onClick={undo}
                title="取り消し（編集モードのみ）"
              >
                <span className="inline-flex items-center gap-1">
                  <Undo2 className="w-4 h-4" />
                  Undo
                </span>
              </button>
            )}
            <button
              className={`px-3 py-1 rounded-xl border text-sm active:scale-[0.98] ${
                editMode
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-neutral-300 hover:bg-neutral-100"
              }`}
              onClick={toggleMode}
              title="編集モード切替"
            >
              <span className="inline-flex items-center gap-1">
                <Edit3 className="w-4 h-4" />
                {editMode ? "編集終了" : "編集"}
              </span>
            </button>
            <button
              className={`px-3 py-1 rounded-xl border text-sm active:scale-[0.98] ${
                confirmResetStep === 0
                  ? "border-red-200 hover:bg-red-50"
                  : "border-red-400 bg-red-50"
              }`}
              onClick={onReset}
              title="リセット（2段階確認）"
            >
              <span className="inline-flex items-center gap-1">
                <RotateCcw className="w-4 h-4" />
                {confirmResetStep === 0 ? "リセット" : "本当に？"}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* list */}
      <main
        ref={mainRef}
        className="mx-auto w-full max-w-md px-3 py-3 flex-1 overflow-auto"
        style={{ scrollPaddingBottom: kbOffset + getFooterHeight() + 80 }}
      >
        {editMode ? (
          <Reorder.Group
            axis="y"
            values={values}
            onReorder={onReorder}
            className="flex flex-col gap-2"
          >
            {items.map((it, idx) => (
              <Reorder.Item
                key={it.id}
                value={it.id}
                layout
                dragListener
                onDragStart={() => onDragStart(it.id)}
                onDragEnd={onDragEnd}
                className={`group rounded-2xl border bg-white shadow-sm flex items-stretch ${
                  it.selected ? "ring-2 ring-emerald-300" : ""
                }`}
              >
                <button
                  type="button"
                  className="px-2 py-3 shrink-0 text-neutral-400 hover:text-neutral-700 active:scale-[0.98]"
                  onClick={() => toggleSelect(it.id)}
                  title="選択（複数行まとめて並び替え）"
                >
                  <Check
                    className={`w-5 h-5 ${
                      it.selected ? "text-emerald-600" : ""
                    }`}
                  />
                </button>
                <div className="flex-1 py-2 pr-2">
                  <input
                    ref={setInputRef(it.id)}
                    className="w-full bg-transparent outline-none py-1 text-base"
                    placeholder="項目を入力..."
                    value={it.text}
                    onFocus={() => {
                      ensureVisible(focusMap.current[it.id]);
                    }}
                    onInput={() => {
                      ensureVisible(focusMap.current[it.id]);
                    }}
                    onChange={(e) => updateText(it.id, e.target.value)}
                    onKeyDown={(e) => onKeyDown(e, idx, it.id)}
                    onPaste={(e) => onPaste(e, idx, it.id)}
                    inputMode="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    style={{
                      scrollMarginBottom: kbOffset + getFooterHeight() + 80,
                    }}
                  />
                </div>
                <div className="flex flex-col justify-center items-center w-9 text-neutral-400">
                  <GripVertical className="w-5 h-5" />
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  className={`w-full rounded-2xl border bg-white shadow-sm px-3 py-3 text-left active:scale-[0.99] ${
                    it.checked ? "opacity-60 line-through" : ""
                  }`}
                  onClick={() => toggleCheck(it.id)}
                >
                  {it.text || "（空）"}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* 下部余白（キーボード上に空間確保）*/}
        <div style={{ height: kbOffset }} />
      </main>

      {/* footer */}
      <footer
        ref={footerRef}
        className="sticky bottom-0 z-10 bg-white/90 backdrop-blur border-t border-neutral-200"
      >
        <div className="mx-auto max-w-md px-4 py-2 text-xs text-neutral-600 flex flex-col gap-1">
          {editMode ? (
            <>
              <div>・Enterで下に新しい行を追加／複数行ペースト対応</div>
              <div>
                ・チェックアイコンで複数選択 → 最上行を掴むとまとめて移動
              </div>
              <div>・編集終了で空白行は自動削除</div>
            </>
          ) : (
            <>
              <div>
                ・項目をタップでチェック／未チェック切替（チェック済みは下に移動）
              </div>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

// ---------- tests (do not modify existing; add where missing) ----------
(function runDevTests() {
  if (typeof window === "undefined") return;
  try {
    console.groupCollapsed("買い物チェックリスト: 基本テスト");
    // Test 1: isBlank
    console.assert(isBlank("   ") === true, "isBlank 空白");
    console.assert(isBlank("a") === false, "isBlank 非空");

    // Test 2: hasLineBreak
    console.assert(hasLineBreak("a\nb") === true, "hasLineBreak LF");
    console.assert(hasLineBreak("abc") === false, "hasLineBreak none");

    // Test 3: mergePaste（1行目は結合、以降はrest）
    const mp = mergePaste("milk", 2, 2, "123\n456\n\n789");
    console.assert(mp.merged === "mi123lk", "mergePaste merged");
    console.assert(
      Array.isArray(mp.rest) &&
        mp.rest.length === 2 &&
        mp.rest[0] === "456" &&
        mp.rest[1] === "789",
      "mergePaste rest"
    );

    // Test 4: チェック済みは下へソート
    const sample = [
      { id: "a", checked: false },
      { id: "b", checked: true },
      { id: "c", checked: false },
      { id: "d", checked: true },
    ];
    const sorted = [...sample].sort(
      (x, y) => Number(x.checked) - Number(y.checked)
    );
    console.assert(
      sorted.map((x) => x.id).join("") === "acbd",
      "checkedソート順 acbd"
    );

    // Test 5: グループドラッグのトップ判定（論理テスト）
    const itemsMock = [
      { id: "1", selected: true },
      { id: "2", selected: true },
      { id: "3", selected: false },
    ];
    const topMostSelectedId = (itemsMock.find((i) => i.selected) || { id: "" })
      .id;
    console.assert(topMostSelectedId === "1", "トップ最上は1");

    console.groupEnd();
  } catch (e) {
    console.warn("テスト中に例外", e);
  }
})();
