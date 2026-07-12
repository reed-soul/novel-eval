import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ProjectList } from './pages/ProjectList.tsx';
import { ProjectDetail } from './pages/ProjectDetail.tsx';
import { ChapterReader } from './pages/ChapterReader.tsx';
import { StateView } from './pages/StateView.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/projects/:id/chapters/:n" element={<ChapterReader />} />
        <Route path="/projects/:id/state" element={<StateView />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
