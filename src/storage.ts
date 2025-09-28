// src/storage.ts
// 複数リストの保存・取得・一覧プレビュー用ユーティリティ
// 保存先: IndexedDB（idb-keyval）
// npm i idb-keyval
import {
  createStore,
  get,
  set,
  del as idbDel,
  keys,
  entries,
  setMany,
  getMany,
  update as idbUpdate,
} from "idb-keyval";

// ==== 型定義 ====
export type ListItem = {
  id: string;
  text: string;
  checked: boolean;
};

export type List = {
  id: string;
  title: string;
  items: ListItem[];
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
};

export type ListMeta = {
  id: string;
  title: string;
  updatedAt: number;
  previewItems: Array<Pick<ListItem, "id" | "text" | "checked">>;
};

// ==== ストア設定 ====
// 独自DB/Storeを使う（デフォは keyval-store/keyval）
const store = createStore("shoppinglist-db", "lists"); // :contentReference[oaicite:3]{index=3}

// キー命名規則
const KEY_PREFIX_LIST = "list:";
const KEY_LAST_OPENED = "ui:lastOpenedListId";

// ユーティリティ
const now = () => Date.now();
// 置き換え例
const uuid = () =>
  globalThis.crypto &&
  typeof (globalThis.crypto as any).randomUUID === "function"
    ? (globalThis.crypto as any).randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

// ==== CRUD ====

/** 新規リストを作成してIDを返す */
export async function createList(
  init?: Partial<Pick<List, "title" | "items">>
): Promise<string> {
  const id = uuid();
  const base: List = {
    id,
    title: init?.title ?? "新しいリスト",
    items: (init?.items ?? []).map((it) => ({ ...it, id: it.id ?? uuid() })),
    createdAt: now(),
    updatedAt: now(),
  };
  await set(KEY_PREFIX_LIST + id, base, store);
  return id;
}

/** リストを取得 */
export async function getList(id: string): Promise<List | undefined> {
  const data = await get<List>(KEY_PREFIX_LIST + id, store);
  return data;
}

/** リストを更新（updatedAtを自動更新） */
export async function updateList(next: List): Promise<void> {
  const copy: List = { ...next, updatedAt: now() };
  await set(KEY_PREFIX_LIST + next.id, copy, store);
}

/** リストを削除 */
export async function deleteList(id: string): Promise<void> {
  await idbDel(KEY_PREFIX_LIST + id, store);
}

/** 複数IDの一括取得（最適化用） */
export async function getListsByIds(
  ids: string[]
): Promise<(List | undefined)[]> {
  const ks = ids.map((id) => KEY_PREFIX_LIST + id);
  return getMany<List>(ks, store);
}

/** 全リストの一覧メタ（プレビュー4件付き）を返す */
export async function getAllLists(): Promise<ListMeta[]> {
  // entries()で全件取得してprefixフィルタ（小規模なのでこれで十分） :contentReference[oaicite:4]{index=4}
  const all = await entries<string, List>(store);
  const lists: List[] = [];
  for (const [k, v] of all) {
    if (k.startsWith(KEY_PREFIX_LIST) && v) lists.push(v);
  }
  // 更新日時降順でソート
  lists.sort((a, b) => b.updatedAt - a.updatedAt);
  // プレビューは items の先頭4件（表示順をそのまま）
  return lists.map((l) => ({
    id: l.id,
    title: l.title,
    updatedAt: l.updatedAt,
    previewItems: l.items
      .slice(0, 4)
      .map(({ id, text, checked }) => ({ id, text, checked })),
  }));
}

/** 直近で開いたリストIDの保存/取得（起動時のリダイレクト等に利用） */
export async function setLastOpenedListId(id: string): Promise<void> {
  await set(KEY_LAST_OPENED, id, store);
}
export async function getLastOpenedListId(): Promise<string | undefined> {
  return get<string>(KEY_LAST_OPENED, store);
}

/** 共有受信テキストから ListItem[] を生成（改行区切り） */
export function parseItemsFromSharedText(text: string): ListItem[] {
  // 仕様：関係ない整形はしない（空行だけ除去）
  return text
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => ({ id: uuid(), text: s, checked: false }));
}

/** 旧バージョン（単一リスト）からの移行の雛形（必要な場合だけ呼ぶ） */
export async function migrateFromLegacyIfNeeded(
  readLegacy: () => Promise<List | undefined>
): Promise<void> {
  const legacy = await readLegacy();
  if (!legacy) return;

  // 既に同IDが存在するならスキップ
  const exists = await get<List>(KEY_PREFIX_LIST + legacy.id, store);
  if (exists) return;

  const migrated: List = {
    id: legacy.id || uuid(),
    title: legacy.title || "旧データ",
    items: (legacy.items || []).map((it) => ({ ...it, id: it.id ?? uuid() })),
    createdAt: legacy.createdAt || now(),
    updatedAt: now(),
  };
  await set(KEY_PREFIX_LIST + migrated.id, migrated, store);
}

/** 自動保存ヘルパ（デバウンス付） */
export function createAutoSaver<T extends List>(
  save: (l: T) => Promise<void>,
  delayMs = 500
) {
  let t: number | undefined;
  let pending: T | undefined;
  return (next: T) => {
    pending = next;
    if (t) clearTimeout(t);
    // @ts-ignore: setTimeout in DOM returns number
    t = setTimeout(async () => {
      if (!pending) return;
      await save(pending);
      pending = undefined;
    }, delayMs) as any as number;
  };
}
