import React from "react";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createStore, set as idbSet } from "idb-keyval";

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
  updatedAt: number;
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function parseLines(text: string): string[] {
  return (text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function ShareLanding() {
  const nav = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    // Web Share Target（GET）：title / text / url で渡るのが基本
    // 参考: MDN / React Router useNavigate / Chrome Docs
    // title -> リスト名として使用
    // text  -> 各行をアイテム化
    const title = params.get("title") || "共有からのリスト";
    const text = params.get("text") || "";
    const url = params.get("url") || "";

    const lines = parseLines(text || url); // text優先。textが空ならurlを1行として扱う
    const items: SavedItem[] =
      lines.length > 0
        ? lines.map((t) => ({ id: uid(), text: t, checked: false }))
        : [{ id: uid(), text: "", checked: false }];

    const id = uid();
    const now = Date.now();
    const save: SavedList = { id, title, items, updatedAt: now };

    (async () => {
      try {
        // （将来）現在の編集中リストがあれば保存してから…の処理をここに追加予定
        await idbSet(id, save, listStore);
        nav(`/lists/${id}`, { replace: true });
      } catch (e) {
        console.error("Share import failed:", e);
        // フォールバック：一覧へ
        nav("/lists", { replace: true });
      }
    })();
  }, [params, nav]);

  return <div style={{ padding: 16 }}>共有データを取り込み中…</div>;
}

export default ShareLanding;
