import React, { useMemo, useState } from "react";

type Props = {
  sharedText: string;
  open: boolean;
  onClose: () => void;
  listOptions: { id: string; name: string }[];
  createNewFromText: (text: string) => void;
  appendToList: (listId: string, text: string) => void;
};

export default function ShareImportDialog({
  sharedText,
  open,
  onClose,
  listOptions,
  createNewFromText,
  appendToList,
}: Props) {
  const [mode, setMode] = useState<"new" | "append">("new");
  const [targetId, setTargetId] = useState<string>(listOptions[0]?.id ?? "");
  const lines = useMemo(
    () =>
      sharedText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    [sharedText]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]">
      <div className="bg-white rounded-xl shadow-xl w-[min(92vw,560px)] p-6">
        <h2 className="text-lg font-bold mb-4">共有テキストの取り込み</h2>

        <div className="space-y-4">
          <div>
            <div className="font-semibold">取り込みモード</div>
            <label className="flex items-center gap-2 mt-2">
              <input
                type="radio"
                name="mode"
                value="new"
                checked={mode === "new"}
                onChange={() => setMode("new")}
              />
              新規リストを作成
            </label>
            <label className="flex items-center gap-2 mt-2">
              <input
                type="radio"
                name="mode"
                value="append"
                checked={mode === "append"}
                onChange={() => setMode("append")}
              />
              既存リストに追加
            </label>
          </div>

          {mode === "append" && (
            <div>
              <div className="font-semibold">追加先リスト</div>
              <select
                className="mt-2 w-full border rounded p-2"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {listOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="font-semibold">プレビュー（{lines.length}件）</div>
            <div className="mt-2 max-h-48 overflow-auto border rounded p-2 text-sm whitespace-pre-wrap">
              {lines.join("\n")}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button className="px-3 py-2 border rounded" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="px-3 py-2 rounded bg-blue-600 text-white"
            onClick={() => {
              if (mode === "new") {
                createNewFromText(sharedText);
              } else {
                if (targetId) appendToList(targetId, sharedText);
              }
              onClose();
            }}
          >
            取り込み
          </button>
        </div>
      </div>
    </div>
  );
}
