import React, { useEffect, useMemo, useState } from "react";
import ShareImportDialog from "./components/ShareImportDialog";

type Item = { id: string; label: string; done: boolean };
type List = { id: string; name: string; items: Item[] };

// ---- 仮のストレージ実装（localStorage） ----
const LS_KEY = "lists";

function loadLists(): List[] {
  try {
    const json = localStorage.getItem(LS_KEY);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

function saveLists(lists: List[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(lists));
}

function uuid() {
  return crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}
// -------------------------------------------

export default function App() {
  const [lists, setLists] = useState<List[]>(() => loadLists());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sharedText, setSharedText] = useState("");

  const listOptions = useMemo(
    () => lists.map((l) => ({ id: l.id, name: l.name })),
    [lists]
  );

  // 新規リスト作成（従来動作に寄せる）
  const createNewFromText = (text: string) => {
    const items = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const id = uuid();
    const name = "共有取り込み " + new Date().toLocaleString();
    const newList: List = {
      id,
      name,
      items: items.map((t) => ({ id: uuid(), label: t, done: false })),
    };
    const next = [newList, ...lists];
    setLists(next);
    saveLists(next);
  };

  // 既存リストへ末尾追加（今回の要件）
  const appendToList = (listId: string, text: string) => {
    const items = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const next = lists.map((l) => {
      if (l.id !== listId) return l;
      const appended = [
        ...(l.items ?? []),
        ...items.map((t) => ({ id: uuid(), label: t, done: false })),
      ];
      return { ...l, items: appended };
    });
    setLists(next);
    saveLists(next);
  };

  // Service Worker からのメッセージで起動
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const handler = (ev: MessageEvent) => {
        if ((ev.data as any)?.type === "OPEN_SHARE_IMPORT") {
          const text = String((ev.data as any)?.sharedText || "");
          setSharedText(text);
          setDialogOpen(true);
        }
      };
      navigator.serviceWorker.addEventListener("message", handler);
      return () =>
        navigator.serviceWorker.removeEventListener("message", handler);
    }
  }, []);

  // URL クエリでのフォールバック起動（/?share-import=1&sharedText=...）
  useEffect(() => {
    const usp = new URLSearchParams(location.search);
    if (usp.get("share-import") === "1") {
      const text = usp.get("sharedText") || "";
      setSharedText(text);
      setDialogOpen(true);
      // 表示後にクエリを消す
      history.replaceState(null, "", location.pathname);
    }
  }, []);

  // --- 以下、簡易UI（動作確認用） ---
  const [newListName, setNewListName] = useState("");
  const addEmptyList = () => {
    if (!newListName.trim()) return;
    const next = [
      { id: uuid(), name: newListName.trim(), items: [] as Item[] },
      ...lists,
    ];
    setLists(next);
    saveLists(next);
    setNewListName("");
  };

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Shopping List</h1>
        <button
          className="px-3 py-2 border rounded"
          onClick={() => {
            // テスト用：モーダル手動起動
            setSharedText("りんご\n牛乳\nパン");
            setDialogOpen(true);
          }}
        >
          取り込みテスト
        </button>
      </header>

      <section className="mb-6">
        <div className="flex gap-2">
          <input
            className="border rounded p-2 flex-1"
            placeholder="新しい空のリスト名"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
          />
          <button
            className="px-3 py-2 rounded bg-blue-600 text-white"
            onClick={addEmptyList}
          >
            空リスト作成
          </button>
        </div>
      </section>

      <main className="space-y-6">
        {lists.map((list) => (
          <div key={list.id} className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">{list.name}</h2>
              <small>{list.items.length} items</small>
            </div>
            <ul className="list-disc pl-6">
              {list.items.map((it) => (
                <li key={it.id}>{it.label}</li>
              ))}
            </ul>
          </div>
        ))}
        {lists.length === 0 && (
          <p className="text-sm text-gray-600">
            リストがありません。上の入力欄から作成するか、共有取り込みをお試しください。
          </p>
        )}
      </main>

      <ShareImportDialog
        sharedText={sharedText}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        listOptions={listOptions}
        createNewFromText={createNewFromText}
        appendToList={appendToList}
      />
    </div>
  );
}
