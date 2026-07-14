import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ProjectList } from './pages/ProjectList.tsx';
import { NewProject } from './pages/NewProject.tsx';
import { ProjectDetail } from './pages/ProjectDetail.tsx';
import { ChapterReader } from './pages/ChapterReader.tsx';
import { CorrectionReview } from './pages/CorrectionReview.tsx';
import { StateView } from './pages/StateView.tsx';
import { Settings } from './pages/Settings.tsx';
import { Evaluation } from './pages/Evaluation.tsx';
import { EvaluationReport } from './pages/EvaluationReport.tsx';
import { Layout } from './components/Layout.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ProjectList />} />
          <Route path="/projects/new" element={<NewProject />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/projects/:id/chapters/:n" element={<ChapterReader />} />
          <Route path="/projects/:id/chapters/:n/correction" element={<CorrectionReview />} />
          <Route path="/projects/:id/state" element={<StateView />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/eval" element={<Evaluation />} />
          <Route path="/eval/:taskId" element={<EvaluationReport />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
