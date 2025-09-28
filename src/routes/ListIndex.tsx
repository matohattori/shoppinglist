import React from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createStore, entries, set as idbSet, del as idbDel } from "idb-keyval";

// ====== IndexedDB store (shoppinglist-db / lists) ======
const listStore = createStore("shoppinglist-db", "lists");

type SavedItem = {
  id: string;
  text: string;
  checked: boolean;
  _checkedAt?: number;
};

type SavedList = {
  id: string;
  title: string;
  items: SavedItem[];
  updatedAt: number; // epoch ms
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function makePreview(items: SavedItem[], limit = 4) {
  const lines = items
    .map((i) => (i.text || "").trim())
    .filter((t) => t.length > 0)
    .slice(0, limit);
  return lines;
}

export function ListIndex() {
  const nav = useNavigate();
  const [lists, setLists] = useState<SavedList[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const all = await entries<string, SavedList>(listStore);
      const arr = all
        .map((pair: [string, SavedList]) => pair[1])
        .filter(Boolean) as SavedList[];

      // 新しい順
      arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setLists(arr);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onCreate = async () => {
    const id = uid();
    const now = Date.now();
    const blank: SavedList = {
      id,
      title: "新しいリスト",
      items: [{ id: uid(), text: "", checked: false }],
      updatedAt: now,
    };
    await idbSet(id, blank, listStore);
    nav(`/lists/${id}`);
  };

  const onDelete = async (id: string) => {
    if (!confirm("このリストを削除しますか？")) return;
    await idbDel(id, listStore);
    refresh();
  };

  const cols = 2;
  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gap: 12,
  };

  return (
    <div style={{ padding: 16 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18 }}>保存されたリスト</h1>
        <button
          onClick={onCreate}
          title="新しいリスト"
          style={{
            padding: "8px 12px",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: "#fff",
          }}
        >
          ＋ 新規
        </button>
      </header>

      {loading ? (
        <div>読み込み中…</div>
      ) : lists.length === 0 ? (
        <div style={{ color: "#6b7280" }}>
          まだ保存されたリストはありません。右上の「新規」で作成できます。
        </div>
      ) : (
        <div style={gridStyle}>
          {lists.map((lst) => {
            const preview = makePreview(lst.items, 4);
            return (
              <button
                key={lst.id}
                onClick={() => nav(`/lists/${lst.id}`)}
                title={lst.title || "（無題）"}
                style={{
                  textAlign: "left",
                  padding: 12,
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  background: "#fff",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}
                  >
                    {lst.title || "（無題）"}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                    aria-label="更新日時"
                  >
                    {new Date(lst.updatedAt).toLocaleString()}
                  </div>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {preview.length === 0 ? (
                    <li style={{ color: "#94a3b8" }}>（項目なし）</li>
                  ) : (
                    preview.map((line, i) => <li key={i}>{line}</li>)
                  )}
                </ul>

                {/* ゴミ箱（必要なら） */}
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(lst.id);
                    }}
                    title="削除"
                    style={{
                      padding: "6px 10px",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      background: "#fff",
                      fontSize: 12,
                      color: "#ef4444",
                    }}
                  >
                    削除
                  </button>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ListIndex;
