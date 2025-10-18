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

// ========================= Swipe-to-Delete Hook =========================
function useSwipeToDelete(onDelete: () => void, enabled: boolean = true) {
  const [swipeState, setSwipeState] = useState<{
    swiping: boolean;
    offsetX: number;
    deleting: boolean;
  }>({ swiping: false, offsetX: 0, deleting: false });
  const swipeRef = useRef<{
    startX: number;
    startY: number;
    currentX: number;
    width: number;
    started: boolean;
    shouldPreventClick: boolean;
  } | null>(null);

  const SWIPE_THRESHOLD = 0.35; // 35% of width
  const SWIPE_START_PX = 8;

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!enabled) return;
    
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    swipeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      width: rect.width,
      started: false,
      shouldPreventClick: false,
    };

    const handlePointerMove = (ev: PointerEvent) => {
      if (!swipeRef.current) return;
      const dx = ev.clientX - swipeRef.current.startX;
      const dy = ev.clientY - swipeRef.current.startY;

      // Check if movement threshold exceeded
      if (!swipeRef.current.started && Math.abs(dx) < SWIPE_START_PX && Math.abs(dy) < SWIPE_START_PX) {
        return;
      }

      // If vertical movement is more than horizontal, don't start swipe
      if (!swipeRef.current.started && Math.abs(dy) > Math.abs(dx)) {
        cleanup();
        return;
      }

      // If we're starting a swipe, prevent click and default behavior
      if (!swipeRef.current.started && Math.abs(dx) >= SWIPE_START_PX) {
        swipeRef.current.shouldPreventClick = true;
        ev.preventDefault();
      }

      // Prevent default to avoid scrolling during horizontal swipe
      if (swipeRef.current.started) {
        ev.preventDefault();
      }

      swipeRef.current.started = true;
      swipeRef.current.currentX = ev.clientX;

      // Only allow right swipe (positive dx)
      const offset = Math.max(0, dx);
      setSwipeState({ swiping: true, offsetX: offset, deleting: false });
    };

    const cleanup = () => {
      if (!swipeRef.current) return;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };

    const handlePointerUp = () => {
      if (!swipeRef.current) return;
      const dx = swipeRef.current.currentX - swipeRef.current.startX;
      const threshold = swipeRef.current.width * SWIPE_THRESHOLD;

      if (dx > threshold) {
        // Trigger delete
        setSwipeState({ swiping: false, offsetX: swipeRef.current.width, deleting: true });
        setTimeout(() => {
          onDelete();
          setSwipeState({ swiping: false, offsetX: 0, deleting: false });
        }, 200); // Wait for slide-out animation
      } else {
        // Return to original position
        setSwipeState({ swiping: false, offsetX: 0, deleting: false });
      }

      cleanup();
      // Keep the ref for a moment to allow click handler to check shouldPreventClick
      setTimeout(() => {
        swipeRef.current = null;
      }, 0);
    };

    const handlePointerCancel = () => {
      setSwipeState({ swiping: false, offsetX: 0, deleting: false });
      cleanup();
      swipeRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerCancel, { passive: false });
  };

  return {
    swipeState,
    onPointerDown,
    shouldPreventClick: () => swipeRef.current?.shouldPreventClick ?? false,
  };
}

const STORAGE_KEY = "shopping_list_v1_react";
const HISTORY_LIMIT = 10;
const ROW_SPACING = 6; // px between rows (margin-top for rows except first)
const ROW_H = 44; // ★ 固定タイル高さ（px）
const DRAG_START_PX =
  navigator.maxTouchPoints || "ontouchstart" in window ? 2 : 6;
const CHECKED_VH = 28; // 非編集時：チェック済みエリアの固定高さ（vh）
const UNCHECKED_VH = 52; // 非編集時：未チェックエリアの固定高さ（vh）
const BUTTONS_VH = 20; // ボタンエリアの固定高さ（vh）
const EDIT_UNCHECKED_VH = UNCHECKED_VH + CHECKED_VH; // 編集モード時は未チェックを拡張（案A）

// ★ 全チェック時の背景候補（5枚）
const ALL_DONE_IMAGES = [
  "/hawaii1.png",
  "/hawaii2.png",
  "/hawaii3.png",
  "/hawaii4.png",
  "/hawaii5.png",
];

// ---- 後方互換のための単一URL（存在すれば優先） ----
const getAllDoneBgUrl = () =>
  ((window as any).__ALL_DONE_BG_URL as string) || "/hawaii.png";

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
  const lines = pasted.split(/\r?\n/).filter((l) => l.length > 0);
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

// ==== viewport helpers (mobile iframe 100vh fix) ====
function useRealViewportHeight() {
  useEffect(() => {
    const set = () => {
      const h = window.innerHeight;
      document.documentElement.style.setProperty("--app-vh", `${h}px`);
    };
    set();
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    window.addEventListener("resize", set);
    window.addEventListener("orientationchange", set);
    vv?.addEventListener("resize", set);
    vv?.addEventListener("scroll", set);
    return () => {
      window.removeEventListener("resize", set);
      window.removeEventListener("orientationchange", set);
      vv?.removeEventListener("resize", set);
      vv?.removeEventListener("scroll", set);
    };
  }, []);
}

// ========================= App =========================
export default function App() {
  // 現在のリストを保存ボックスに保存する
  const saveCurrentListToBox = () => {
    try {
      const validItems = state.items.filter((it: Item) => it.text.trim() !== "");
      if (validItems.length === 0) return; // 空リストは保存しない
      
      const boxRaw = localStorage.getItem(STORAGEBOX_KEY);
      const box = boxRaw ? JSON.parse(boxRaw) : [];
      const title = getNowString();
      const entry = {
        id: uid(),
        title,
        savedAt: Date.now(),
        items: validItems,
      };
      box.unshift(entry);
      localStorage.setItem(STORAGEBOX_KEY, JSON.stringify(box));
    } catch (e) {
      console.error("保存に失敗しました:", e);
    }
  };

  // 新規リスト作成用
  const handleNewList = () => {
    // 既存リストを保存ボックスに保存してから新規リスト作成
    saveCurrentListToBox();
    setState({ edit: true, items: [{ id: uid(), text: "", checked: false }] });
    setCurrentStorageBoxId(null);
    // 一番上のアイテムにフォーカス
    setTimeout(() => {
      const ta = document.querySelector(".row textarea") as HTMLTextAreaElement | null;
      ta?.focus();
      ta?.setSelectionRange(0, 0);
    }, 0);
  };
  // 保存完了表示用
  const [saveDone, setSaveDone] = useState(false);
  // 現在編集中の保存ボックスID（nullなら通常リスト）
  const [currentStorageBoxId, setCurrentStorageBoxId] = useState<string | null>(null);
  // 保存ボックスモーダル表示状態
  const LAST_VIEW_KEY = "shoppinglist2_lastview";
  const [showStorageBox, setShowStorageBox] = useState(() => {
    try {
      const raw = localStorage.getItem(LAST_VIEW_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        return !!obj.showStorageBox;
      }
    } catch {}
    return false;
  });
  // 保存ボックス一覧取得
  function getStorageBoxList() {
    try {
      const boxRaw = localStorage.getItem(STORAGEBOX_KEY);
      return boxRaw ? JSON.parse(boxRaw) : [];
    } catch {
      return [];
    }
  }

  // state初期値もlastviewから復元
  const { state, setState, pushHistory, undo, redo } = usePersistentState((() => {
    try {
      const raw = localStorage.getItem(LAST_VIEW_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj.items && Array.isArray(obj.items)) {
          return {
            edit: typeof obj.edit === 'boolean' ? obj.edit : true,
            items: obj.items,
          };
        }
      }
    } catch {}
    return { edit: true, items: [{ id: uid(), text: "", checked: false }] };
  })());
  // showStorageBox, state.edit, state.items を変更のたび保存
  useEffect(() => {
    try {
      localStorage.setItem(LAST_VIEW_KEY, JSON.stringify({
        showStorageBox,
        edit: state.edit,
        items: state.items,
      }));
    } catch {}
  }, [showStorageBox, state.edit, state.items]);

  // 100vh 問題（スマホ iframe）対策
  useRealViewportHeight();
  useEffect(() => {
    const el = document.documentElement;
    const body = document.body;
    el.style.height = "100%";
    body.style.height = "100%";
    const root =
      document.getElementById("root") || document.getElementById("app");
    if (root) (root as HTMLElement).style.height = "100%";
    return () => {
      el.style.height = "";
      body.style.height = "";
      if (root) (root as HTMLElement).style.height = "";
    };
  }, []);

  // ==== 共有受信方法トグル ====
  const SHARE_MODE_KEY = 'shoppinglist_share_mode';
  const [shareMode, setShareModeState] = useState<'new' | 'append'>(() => {
    try {
      const saved = localStorage.getItem(SHARE_MODE_KEY);
      if (saved === 'append' || saved === 'new') return saved;
    } catch {}
    return 'new';
  });
  const setShareMode = (mode: 'new' | 'append') => {
    setShareModeState(mode);
    try {
      localStorage.setItem(SHARE_MODE_KEY, mode);
    } catch {}
  };
  const [shareModeToast, setShareModeToast] = useState<string | null>(null);

  // Android判定
  const isAndroid = /Android/i.test(navigator.userAgent);
  // 共有受信時の自動処理
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const isSharePath = url.pathname.startsWith("/share");
      const text = url.searchParams.get("text");
      if (!isSharePath || !text || !text.trim()) return;
      // 改行で分割 → 空行除去
      const lines = text.replace(/\r\n/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean);
      pushHistory(state);
      if (shareMode === 'new') {
        // 現在のリストにアイテムがある場合は保存ボックスに保存
        const validItems = state.items.filter((it: Item) => it.text.trim() !== "");
        if (validItems.length > 0) {
          try {
            const boxRaw = localStorage.getItem(STORAGEBOX_KEY);
            const box = boxRaw ? JSON.parse(boxRaw) : [];
            const title = getNowString();
            const entry = {
              id: uid(),
              title,
              savedAt: Date.now(),
              items: validItems,
            };
            box.unshift(entry);
            localStorage.setItem(STORAGEBOX_KEY, JSON.stringify(box));
          } catch {}
        }
        setState({
          edit: true,
          items: lines.map((t) => ({ id: uid(), text: t, checked: false })),
        });
        setCurrentStorageBoxId(null);
      } else {
        setState(({ items, edit }) => ({
          edit: true,
          items: [
            ...items,
            ...lines.map((t) => ({ id: uid(), text: t, checked: false })),
          ],
        }));
      }
      // URLを通常に戻す
      try {
        history.replaceState(null, "", "/");
      } catch {}
      // 最初の行にフォーカス
      setTimeout(() => {
        const ta = document.querySelector(
          ".row textarea"
        ) as HTMLTextAreaElement | null;
        ta?.focus();
        ta?.setSelectionRange(0, 0);
      }, 0);
    } catch {}
    // eslint-disable-next-line
  }, [shareMode]);

  // 複数ペイン用 Refs
  const uncheckedListRef = useRef<HTMLDivElement | null>(null);
  const uncheckedWrapRef = useRef<HTMLDivElement | null>(null);
  const checkedListRef = useRef<HTMLDivElement | null>(null);
  const checkedWrapRef = useRef<HTMLDivElement | null>(null);

  // DnD Refs（未チェック側のみ）
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
  const uncheckedItems = useMemo(
    () => displayItems.filter((i) => !i.checked),
    [displayItems]
  );
  const checkedItemsAsc = useMemo(
    () => displayItems.filter((i) => i.checked),
    [displayItems]
  );

  // 進捗（非空のみ）
  const stats = useMemo(() => {
    const valid = state.items.filter((it) => it.text.trim() !== "");
    const total = valid.length;
    const done = valid.filter((it) => it.checked).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { total, done, pct };
  }, [state.items]);

  // all-checked（通常時のみ）
  const allCheckedBlue =
    !state.edit &&
    state.items.length > 0 &&
    state.items.every((it) => it.checked);

  // 全チェック時の背景画像（5枚からランダム選択、遷移時に決定）
  const [allDoneUrl, setAllDoneUrl] = useState<string | null>(null);
  const prevAllCheckedRef = useRef<boolean>(false);
  const pickRandomAllDone = () =>
    ALL_DONE_IMAGES[Math.floor(Math.random() * ALL_DONE_IMAGES.length)];
  useEffect(() => {
    if (allCheckedBlue) {
      // Only vibrate when transitioning from incomplete to complete
      if (!prevAllCheckedRef.current) {
        vibrateNow([50, 100, 50]);
      }
      const override = (window as any).__ALL_DONE_BG_URL as string | undefined;
      if (override) {
        setAllDoneUrl(override);
      } else {
        const ready: Set<string> | undefined = (window as any).__ALL_DONE_READY__;
        const pool = ready && ready.size ? Array.from(ready) : ALL_DONE_IMAGES;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        setAllDoneUrl(pick);
      }
      prevAllCheckedRef.current = true;
    } else {
      setAllDoneUrl(null);
      prevAllCheckedRef.current = false;
    }
  }, [allCheckedBlue]);

  // タイピング単位（Undo/Redo用）
  const typingRef = useRef<{ active: boolean }>({ active: false });

  // チェック状態をトグルする
  const toggleCheckedById = (id: string) => {
    setState((prev: State) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === id ? { ...it, checked: !it.checked } : it
      ),
    }));
  };

  // タイピング終了処理
  const endTyping = () => {
    typingRef.current.active = false;
  };

  const beginTypingIfNeeded = () => {
    if (!typingRef.current.active) {
      pushHistory(state);
      typingRef.current.active = true;
    }
  };
  const onSave = () => {
    try {
      // 空リストは保存しない
      const validItems = state.items.filter((it: Item) => it.text.trim() !== "");
      if (!validItems.length) {
        alert("空のリストは保存できません");
        return;
      }
      const boxRaw = localStorage.getItem(STORAGEBOX_KEY);
      const box = boxRaw ? JSON.parse(boxRaw) : [];
      // タイトル自動生成
      const title = getNowString();
      const entry = {
        id: uid(),
        title,
        savedAt: Date.now(),
        items: validItems,
      };
      box.unshift(entry); // 先頭に追加
      localStorage.setItem(STORAGEBOX_KEY, JSON.stringify(box));
      setCurrentStorageBoxId(entry.id); // 保存直後はこのリストを編集中とみなす
      setSaveDone(true);
      setTimeout(() => setSaveDone(false), 1000); // 1秒で戻す
    } catch (e) {
      alert("保存に失敗しました: " + e);
    }
  };
  // ...existing code...

  // 画面全体スクロール抑止
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // 全チェック背景画像プリロード（5枚すべて）＋非同期デコード＆readyセット
  useEffect(() => {
    const urls: string[] = (window as any).__ALL_DONE_BG_URL
      ? [(window as any).__ALL_DONE_BG_URL]
      : ALL_DONE_IMAGES;

    // <link rel="preload" as="image"> を追加（重複防止）
    urls.forEach((href) => {
      if (
        !document.querySelector(
          `link[rel="preload"][as="image"][href="${href}"]`
        )
      ) {
        const l = document.createElement("link");
        l.rel = "preload";
        l.as = "image";
        l.href = href;
        document.head.appendChild(l);
      }
    });

    // 画像を先読みし decode 済みを ready に登録
    const ready = new Set<string>();
    urls.forEach((src) => {
      const img = new Image();
      try {
        (img as any).decoding = "async";
      } catch {}
      img.src = src;
      const dec = (img as any).decode;
      if (typeof dec === "function") {
        (dec.call(img) as Promise<void>)
          .then(() => ready.add(src))
          .catch(() => {});
      } else {
        img.onload = () => ready.add(src);
      }
    });
    (window as any).__ALL_DONE_READY__ = ready;
  }, []);

  // ===== Row ops =====
  const setItemTextById = (id: string, text: string) => {
    beginTypingIfNeeded();
    setState((prev: State) => ({
      edit: prev.edit,
      items: prev.items.map((it: Item) => (it.id === id ? { ...it, text } : it)),
    }));
  };

  const toggleSelected = (id: string, v: boolean) => {
    if (!state.edit) return;
    pushHistory(state);
    setState((prev: State) => ({
      edit: prev.edit,
      items: prev.items.map((it: Item) => (it.id === id ? { ...it, _selected: v } : it)),
    }));
  };

  const insertEmptyAfterId = (id: string) => {
    if (!state.edit) return;
    pushHistory(state);
    setState((prev: State) => {
      const pos = prev.items.findIndex((it: Item) => it.id === id);
      if (pos < 0) return { edit: prev.edit, items: prev.items };
      const next = [...prev.items];
      const newItem = { id: uid(), text: "", checked: false };
      next.splice(pos + 1, 0, newItem);
      setTimeout(() => {
        const ta = document.querySelector(
          `.row[data-id="${newItem.id}"] textarea`
        ) as HTMLTextAreaElement | null;
        ta?.focus();
        ta?.setSelectionRange(0, 0);
      }, 0);
      return { edit: prev.edit, items: next };
    });
  };

  const deleteItem = (id: string) => {
    if (!state.edit) return;
    pushHistory(state);
    setState((prev: State) => ({
      edit: prev.edit,
      items: prev.items.filter((it: Item) => it.id !== id),
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
  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    []
  );

  const [storageBoxRefreshKey, setStorageBoxRefreshKey] = useState(0);

  // ===== DnD（未チェック側のみ） =====
  const onPointerDownHandle = (
    e: React.PointerEvent<HTMLElement>,
    id: string,
    suppressDefault = true
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
    const list = uncheckedListRef.current;
    if (!list) return;
    const pressed = uncheckedItems.find((it) => it.id === id);
    if (!pressed) return;

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
      if (!dragRef.current?.started && uncheckedListRef.current)
        startDrag(uncheckedListRef.current, e.clientY);
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
    if (!dragRef.current || !uncheckedListRef.current) return;
    const { startX, startY, started, offsetY, draggingIds, totalH } =
      dragRef.current;
    const dx = Math.abs(ev.clientX - startX),
      dy = Math.abs(ev.clientY - startY);
    if (!started && Math.max(dx, dy) < DRAG_START_PX) return;
    if (!started) startDrag(uncheckedListRef.current, ev.clientY);
    ev.preventDefault();
    if (ghostRef.current)
      ghostRef.current.style.transform = `translate3d(0, ${
        ev.clientY - offsetY
      }px, 0)`;
    if (uncheckedWrapRef.current) {
      const edge = 50;
      const rect = uncheckedWrapRef.current.getBoundingClientRect();
      if (ev.clientY < rect.top + edge)
        uncheckedWrapRef.current.scrollTop -= 12;
      if (ev.clientY > rect.bottom - edge)
        uncheckedWrapRef.current.scrollTop += 12;
    }
    updatePlaceholder(
      uncheckedListRef.current,
      ev.clientY,
      draggingIds,
      totalH
    );
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
    const list = uncheckedListRef.current;
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
        const l = uncheckedListRef.current;
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
    const list = uncheckedListRef.current;
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
    const dr = dragRef.current;
    const topY = clientY - (dr?.offsetY ?? 0);
    const prevY = dr?.lastY ?? dr?.startY ?? clientY;
    const draggingDown = clientY >= prevY;
    const unitH = (() => {
      const n = Math.max(1, draggingIds.length);
      const avg = Math.max(1, Math.round((dr?.totalH ?? totalH) / n));
      return isFinite(avg) && avg > 1 ? avg : ROW_H;
    })();
    let targetIndex = 0;
    for (let i = 0; i < children.length; i++) {
      const he = children[i] as HTMLElement;
      const id = he.dataset?.id || "";
      const rect = he.getBoundingClientRect();
      if (draggingIds.includes(id)) continue;
      const threshold = draggingDown ? rect.top : rect.top + rect.height / 2;
      const probe = draggingDown
        ? topY + (dr?.totalH ?? totalH) - Math.min(rect.height, unitH)
        : clientY;
      if (probe > threshold) targetIndex = i + 1;
    }
    const ref = children[targetIndex] as HTMLElement | undefined;
    const phH = Math.max(ROW_H, totalH - ROW_SPACING);
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
      const isPh = (he as any).dataset?.placeholder === "1";
      const isCollapsed =
        (he as any).dataset?.dragCollapsed === "1" ||
        (he as HTMLElement).style.display === "none";
      return !isPh && !isCollapsed && !draggingIds.includes(id);
    }).length;
    return { insertAt };
  }

  // ============== Render ==============
  useEffect(() => {
    const r = runTests();
    if (r.failed) console.warn("[Tests] Failed:", r.failures);
  }, []);

  // 保存ボタン・保存ボックスボタンのクリックハンドラ
  const STORAGEBOX_KEY = "shoppinglist2_storagebox";
  function z2(n: number) { return (n < 10 ? '0' : '') + n; }
  function getNowString() {
    const d = new Date();
    return (
      d.getFullYear() +
      '-' + z2(d.getMonth() + 1) +
      '-' + z2(d.getDate()) +
      ' ' + z2(d.getHours()) +
      ':' + z2(d.getMinutes())
    );
  }
  // (duplicate onSave removed)
  const onOpenStorageBox = () => {
    setShowStorageBox(true);
  };

  // 保存ボックスリストの自動保存
  useEffect(() => {
    if (!currentStorageBoxId) return;
    // 現在のリストが保存ボックスのどれかと一致する場合のみ
    try {
      const boxRaw = localStorage.getItem(STORAGEBOX_KEY);
      if (!boxRaw) return;
      const box = JSON.parse(boxRaw);
      const idx = box.findIndex((e: any) => e.id === currentStorageBoxId);
      if (idx === -1) return;
      // itemsが違う場合のみ更新
      const curItems = state.items.filter((it: Item) => it.text.trim() !== "");
      const prevItems = box[idx].items || [];
      // 比較: 長さ or どれかの内容が違う
      const isDiff = curItems.length !== prevItems.length || curItems.some((it: Item, i: number) => {
        const p = prevItems[i];
        return !p || p.text !== it.text || p.checked !== it.checked;
      });
      if (isDiff) {
        box[idx] = { ...box[idx], items: curItems, savedAt: Date.now() };
        localStorage.setItem(STORAGEBOX_KEY, JSON.stringify(box));
      }
    } catch {}
  }, [state.items, currentStorageBoxId]);

  return (
    <>
      {/* 保存ボックスモーダル */}
      {showStorageBox && (
        <div
          key={storageBoxRefreshKey}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.25)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={e => {
            // モーダル外クリックで閉じる
            if (e.target === e.currentTarget) setShowStorageBox(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              minWidth: 320,
              maxWidth: 420,
              width: '90vw',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              padding: 20,
              position: 'relative',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{display:'flex',justifyContent:'center',alignItems:'center',margin:'0 0 16px 0'}}>
              {/* 保存ボックスボタンと同じピクトグラム */}
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e42" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><rect x="3" y="3" width="18" height="4" rx="2"/><path d="M3 7v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7"/><path d="M16 10l-4 4-4-4"/></svg>
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
              {getStorageBoxList().length === 0 && (
                <div style={{color: '#888', textAlign: 'center'}}>保存されたリストはありません</div>
              )}
              {[...getStorageBoxList()].sort((a, b) => b.savedAt - a.savedAt).map((entry: any) => (
                <SavedListItem
                  key={entry.id}
                  entry={entry}
                  onDelete={() => {
                    const boxRaw = localStorage.getItem(STORAGEBOX_KEY);
                    if (!boxRaw) return;
                    let box = JSON.parse(boxRaw);
                    box = box.filter((b: any) => b.id !== entry.id);
                    localStorage.setItem(STORAGEBOX_KEY, JSON.stringify(box));
                    setStorageBoxRefreshKey(prev => prev + 1);
                  }}
                  onOpen={() => {
                    saveCurrentListToBox();
                    setState({ edit: true, items: entry.items });
                    setCurrentStorageBoxId(entry.id);
                    setShowStorageBox(false);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
      <div
        style={{
          display: "grid",
          height: "var(--app-vh)",
          gridTemplateRows: state.edit
            ? `auto minmax(0,1fr) auto`
            : `auto ${CHECKED_VH}vh minmax(0,1fr) auto`,
          overflow: "hidden",
        }}
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
      {/* Header: Progress bar + 保存ボタン群 */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 4,
          background: "#fff",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 8px" }}>
          {/* Progress info */}
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
              {stats.done} / {stats.total} ({stats.pct}%)
            </div>
            <div
              aria-label="progress"
              style={{
                height: 8,
                borderRadius: 999,
                background: "#f1f5f9",
                overflow: "hidden",
                boxShadow: "inset 0 0 0 1px #e5e7eb",
                minWidth: 220,
                maxWidth: 340,
                width: '100%',
                marginRight: 16,
              }}
            >
              <div
                style={{
                  width: `${stats.pct}%`,
                  height: "100%",
                  background: "linear-gradient(90deg,#93c5fd,#2563eb)",
                  transition: "width .18s ease",
                }}
              />
            </div>
          </div>
          {/* 保存ボタン群 */}
          <div style={{ display: "flex", gap: 8 }}>
            {/* 新規リストボタン */}
            <button
              onClick={handleNewList}
              title="新規リスト"
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: "#fff",
                display: "grid",
                placeItems: "center",
                fontSize: 20,
                padding: 0,
                cursor: "pointer",
              }}
              aria-label="新規リスト"
            >
              {/* プラスアイコン */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            </button>
            <button
              onClick={onSave}
              title="リストを保存"
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: "#fff",
                display: "grid",
                placeItems: "center",
                fontSize: 20,
                padding: 0,
                cursor: "pointer",
                transition: 'color 0.2s',
                color: saveDone ? '#22c55e' : undefined,
              }}
              aria-label="リストを保存"
            >
              {/* 保存完了時はチェックマーク、それ以外はフロッピーディスク */}
              {saveDone ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9.5 17 4 11.5"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              )}
            </button>
            <button
              onClick={onOpenStorageBox}
              title="保存ボックスを開く"
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: "#fff",
                display: "grid",
                placeItems: "center",
                fontSize: 20,
                padding: 0,
                cursor: "pointer",
              }}
              aria-label="保存ボックスを開く"
            >
              {/* アーカイブ/ボックス風アイコン */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e42" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="4" rx="2"/><path d="M3 7v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7"/><path d="M16 10l-4 4-4-4"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Checked Area（通常時のみ／固定高さ／内部スクロール） */}
      {!state.edit && (
        <div
          ref={checkedWrapRef}
          style={{
            overflow: "auto",
            padding: 10,
            borderBottom: "1px solid #eef2f7",
            background: allCheckedBlue ? "#eaf2ff" : "#f8fafc",
          }}
        >
          <div
            ref={checkedListRef}
            style={{ display: "flex", flexDirection: "column", gap: 0 }}
          >
            {checkedItemsAsc.map((item, i) => (
              <Row
                key={item.id}
                item={item}
                index={i}
                edit={state.edit}
                allCheckedBlue={allCheckedBlue}
                onInput={() => {}}
                onEnter={() => {}}
                onToggleChecked={() => toggleCheckedById(item.id)}
                onToggleSelected={() => {}}
                onDelete={() => {
                  if (state.edit) deleteItem(item.id);
                }}
                onPointerDownHandle={() => {}}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unchecked Area（固定高さ／内部スクロール） */}
      <div
        ref={uncheckedWrapRef}
        style={{
          overflow: "auto",
          padding: 12,
          backgroundImage: allDoneUrl ? `url(${allDoneUrl})` : undefined,
          backgroundSize: allCheckedBlue ? "cover" : undefined,
          backgroundPosition: allCheckedBlue ? "center" : undefined,
          backgroundRepeat: allCheckedBlue ? "no-repeat" : undefined,
        }}
      >
        <div
          ref={uncheckedListRef}
          style={{ display: "flex", flexDirection: "column", gap: 0 }}
        >
          {uncheckedItems.map((item, i) => (
            <Row
              key={item.id}
              item={item}
              index={i}
              edit={state.edit}
              onInput={(t) => setItemTextById(item.id, t)}
              onEnter={() => {
                endTyping();
                insertEmptyAfterId(item.id);
              }}
              onToggleChecked={() => toggleCheckedById(item.id)}
              onToggleSelected={(v) => toggleSelected(item.id, v)}
              onDelete={() => {
                endTyping();
                deleteItem(item.id);
              }}
              onPointerDownHandle={(e) => {
                endTyping();
                onPointerDownHandle(e, item.id, true);
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
        {state.edit && (
          <>
            <button
              onClick={() => {
                const next = shareMode === 'new' ? 'append' : 'new';
                setShareMode(next);
                if (isAndroid) {
                  setShareModeToast(next === 'new' ? '共有は新規' : '共有は追加');
                  setTimeout(() => setShareModeToast(null), 1200);
                }
              }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                display: 'grid',
                placeItems: 'center',
                border: '1px solid #e5e7eb',
                background: shareMode === 'new' ? '#2563eb' : '#f3f4f6',
                color: shareMode === 'new' ? '#fff' : '#111',
                fontWeight: 600,
                fontSize: 20,
                marginRight: 4,
                padding: 0,
                transition: 'background 0.2s',
              }}
              title={shareMode === 'new' ? '共有は新規リスト作成' : '共有は既存リストに追加'}
              aria-label={shareMode === 'new' ? '共有は新規リスト作成' : '共有は既存リストに追加'}
            >
              {shareMode === 'new' ? (
                // 新規リスト: 中央に大きなスパークル（星）1つ
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M14 3L15.5 10.5C15.65 11.2 16.3 11.85 17 12L24.5 13.5L17 15C16.3 15.15 15.65 15.8 15.5 16.5L14 24L12.5 16.5C12.35 15.8 11.7 15.15 11 15L3.5 13.5L11 12C11.7 11.85 12.35 11.2 12.5 10.5L14 3Z" fill="currentColor"/>
                </svg>
              ) : (
                // 追加: プラスマーク
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              )}
            </button>
            {isAndroid && shareModeToast && (
              <span
                style={{
                  position: 'fixed',
                  left: '50%',
                  bottom: 80,
                  transform: 'translateX(-50%)',
                  background: 'rgba(0,0,0,0.85)',
                  color: '#fff',
                  borderRadius: 8,
                  padding: '8px 20px',
                  fontSize: 16,
                  zIndex: 9999,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  pointerEvents: 'none',
                  transition: 'opacity 0.2s',
                }}
              >
                {shareModeToast}
              </span>
            )}
          </>
        )}
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
            setState((s) => ({
              edit: !s.edit,
              items: s.edit ? s.items.filter((it) => it.text.trim() !== "") : s.items
            }));
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
    </>
  );
}

// ========================= SavedListItem Component =========================
function SavedListItem(props: {
  entry: any;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const { entry, onDelete, onOpen } = props;
  const { swipeState, onPointerDown } = useSwipeToDelete(onDelete);

  const wrapperStyle: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 10,
  };

  const contentStyle: React.CSSProperties = {
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '10px 12px',
    background: '#f8fafc',
    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transform: `translateX(${swipeState.offsetX}px)`,
    transition: swipeState.swiping ? "none" : swipeState.deleting ? "transform 0.15s ease-out, opacity 0.1s ease-out" : "transform 0.2s ease-out",
    opacity: swipeState.deleting ? 0 : 1,
    touchAction: 'none',
  };

  const redBarStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
    background: '#ef4444',
    display: 'flex',
    alignItems: 'center',
    paddingLeft: 16,
    borderRadius: 10,
  };

  return (
    <div style={wrapperStyle}>
      {/* Red background bar with trash icon */}
      <div style={redBarStyle}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </div>
      
      {/* Sliding content */}
      <div style={contentStyle} onPointerDown={(e) => {
        e.preventDefault();
        onPointerDown(e);
      }}>
        <div
          style={{ flex: 1, cursor: 'pointer' }}
          onClick={onOpen}
          title="このリストを表示"
        >
          <div style={{fontWeight: 600, fontSize: 16, marginBottom: 4}}>
            {/* 最終更新日時のみ表示 */}
            {(() => {
              const d = new Date(entry.savedAt);
              const z2 = (n: number) => (n < 10 ? '0' : '') + n;
              return `${d.getFullYear()}-${z2(d.getMonth()+1)}-${z2(d.getDate())} ${z2(d.getHours())}:${z2(d.getMinutes())}`;
            })()}
          </div>
          <div style={{fontSize: 13, color: '#666', display: 'flex', flexWrap: 'wrap', gap: 6}}>
            {entry.items.slice(0, 4).map((it: any, idx: number) => (
              <span key={idx} style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                padding: '2px 8px',
                marginRight: 2,
                maxWidth: 100,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'inline-block',
              }}>{it.text}</span>
            ))}
            {entry.items.length > 4 && <span style={{color: '#aaa'}}>…</span>}
          </div>
        </div>
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
    ta.style.padding = "0";
    const innerH = Math.max(1, ROW_H - 12); // タイルpadding(上下6px)を除いた高さ
    ta.style.height = innerH + "px";
    ta.style.lineHeight = innerH + "px"; // テキストを垂直中央に
    ta.style.fontSize = "16px";
  }, [item.text, edit]);

  const bgColor = item.checked
    ? allCheckedBlue
      ? "#2563eb"
      : "#cbd5e1"
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
    height: ROW_H,
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
          onBlur={() => {}}
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            color: "#777",
            textDecoration: "line-through",
            padding: 0,
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
              vibrateNow(20);
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
            props.onEnter();
          }
        }}
        onPaste={(e) => {
          if (!edit) return;
          const data = e.clipboardData || (window as any).clipboardData;
          const text = data?.getData?.("text") ?? "";
          if (!text || !text.includes("\n")) return;
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
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          resize: "none",
          background: "transparent",
          textDecoration: item.checked ? "line-through" : "none",
          padding: 0,
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

  // 1) reorderByInsert contiguous
  tests.push({
    name: "reorderByInsert contiguous",
    fn: () => {
      const a: Item = { id: "a", text: "a", checked: false };
      const b: Item = { id: "b", text: "b", checked: false };
      const c: Item = { id: "c", text: "c", checked: false };
      const d: Item = { id: "d", text: "d", checked: false };
      const out = reorderByInsert([a, b, c, d], [b.id, c.id], 0);
      if (out.map((x) => x.id).join("") !== "bcad") throw new Error("wrong");
    },
  });

  // 2) reorderAndUncheck clears flags
  tests.push({
    name: "reorderAndUncheck clears flags",
    fn: () => {
      const a: Item = { id: "a", text: "a", checked: true, _selected: true };
      const b: Item = { id: "b", text: "b", checked: false };
      const out = reorderAndUncheck([a, b], [a.id], 1);
      if (!(out[1].id === "a" && !out[1].checked && !out[1]._selected))
        throw new Error("flags not cleared");
    },
  });

  // 3) sortUncheckedFirst order (unchecked first, then checked by time asc)
  tests.push({
    name: "sortUncheckedFirst order",
    fn: () => {
      const a: Item = { id: "a", text: "a", checked: true, _checkedAt: 200 };
      const b: Item = { id: "b", text: "b", checked: false };
      const c: Item = { id: "c", text: "c", checked: true, _checkedAt: 300 };
      const out = sortUncheckedFirst([a, b, c]);
      if (out.map((o) => o.id).join("") !== "bac") throw new Error("order");
    },
  });

  // 4) pasteMerge splits correctly
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

  // 5) pasteMerge single line no rest
  tests.push({
    name: "pasteMerge single line no rest",
    fn: () => {
      const { first, rest } = pasteMerge("aa", 1, "Z");
      if (first !== "aZa" || rest.length !== 0)
        throw new Error("single-line paste");
    },
  });

  // 6) reorderAndUncheck multi move
  tests.push({
    name: "reorderAndUncheck multi move",
    fn: () => {
      const x = (id: string): Item => ({ id, text: id, checked: false });
      const arr: Item[] = [x("a"), x("b"), x("c"), x("d")];
      const out = reorderAndUncheck(arr, ["b", "c"], 3);
      if (out.map((o) => o.id).join("") !== "adbc")
        throw new Error("multi move order");
    },
  });

  // 7) pasteMerge CRLF
  tests.push({
    name: "pasteMerge CRLF",
    fn: () => {
      const { first, rest } = pasteMerge("foo", 3, "\r\nA\r\nB");
      if (first !== "foo") throw new Error("crlf first");
      if (rest.join("") !== "AB") throw new Error("crlf rest");
    },
  });

  // 8) sortUncheckedFirst checked by _checkedAt asc
  tests.push({
    name: "sortUncheckedFirst checked by _checkedAt asc",
    fn: () => {
      const u: Item = { id: "u", text: "u", checked: false };
      const a: Item = { id: "a", text: "a", checked: true, _checkedAt: 100 };
      const b: Item = { id: "b", text: "b", checked: true, _checkedAt: 200 };
      const out = sortUncheckedFirst([a, u, b]);
      if (out.map((o) => o.id).join("") !== "uab")
        throw new Error("checked order by time asc");
    },
  });

  // 9) reorderByInsert clamps insertAt (too large)
  tests.push({
    name: "reorderByInsert clamps insertAt",
    fn: () => {
      const a: Item = { id: "a", text: "a", checked: false };
      const b: Item = { id: "b", text: "b", checked: false };
      const c: Item = { id: "c", text: "c", checked: false };
      const out = reorderByInsert([a, b, c], [a.id], 99);
      if (out.map((o) => o.id).join("") !== "bac")
        throw new Error("clamp failed");
    },
  });

  // 10) reorderByInsert clamps insertAt (negative)
  tests.push({
    name: "reorderByInsert clamps negative",
    fn: () => {
      const a: Item = { id: "a", text: "a", checked: false };
      const b: Item = { id: "b", text: "b", checked: false };
      const c: Item = { id: "c", text: "c", checked: false };
      const out = reorderByInsert([a, b, c], [b.id], -10);
      if (out.map((o) => o.id).join("") !== "bac")
        throw new Error("negative clamp failed");
    },
  });

  // 11) sortUncheckedFirst treats undefined _checkedAt as 0 (falls before larger timestamps)
  tests.push({
    name: "sortUncheckedFirst undefined _checkedAt treated as 0",
    fn: () => {
      const u: Item = { id: "u", text: "u", checked: false };
      const a: Item = { id: "a", text: "a", checked: true }; // _checkedAt undefined -> 0
      const b: Item = { id: "b", text: "b", checked: true, _checkedAt: 5 };
      const out = sortUncheckedFirst([b, u, a]);
      if (out.map((o) => o.id).join("") !== "uab")
        throw new Error("undefined timestamp ordering");
    },
  });

  // 12) pasteMerge empty/only newlines -> unchanged
  tests.push({
    name: "pasteMerge empty or newlines only",
    fn: () => {
      const o = "hello";
      const { first, rest } = pasteMerge(o, 2, "\n\n\r\n");
      if (first !== o || rest.length !== 0)
        throw new Error("empty/newlines handling");
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
