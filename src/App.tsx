// src/App.tsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ChecklistPage } from "./routes/ListDetail";
import { ListIndex } from "./routes/ListIndex";
import { ShareLanding } from "./routes/ShareLanding";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/lists" replace />} />
        <Route path="/lists" element={<ListIndex />} />
        <Route path="/lists/:id" element={<ChecklistPage />} />
        <Route path="/share" element={<ShareLanding />} />
        <Route path="*" element={<Navigate to="/lists" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
