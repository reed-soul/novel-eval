import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ProjectList } from './pages/ProjectList.tsx';
import { NewProject } from './pages/NewProject.tsx';
import { ProjectDetail } from './pages/ProjectDetail.tsx';
import { ChapterReader } from './pages/ChapterReader.tsx';
import { CorrectionReview } from './pages/CorrectionReview.tsx';
import { StateView } from './pages/StateView.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Settings } from './pages/Settings.tsx';
import { Evaluation } from './pages/Evaluation.tsx';
import { EvaluationReport } from './pages/EvaluationReport.tsx';
import { Audit } from './pages/Audit.tsx';
import { Layout } from './components/Layout.tsx';
import { BookAudiobook } from './pages/BookAudiobook.tsx';
import { AudiobookEpisode } from './pages/AudiobookEpisode.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ProjectList />} />
          <Route path="/projects/new" element={<NewProject />} />
          {/* 旧路由重定向（M0 验收1：旧入口引导选书） */}
          <Route path="/projects/:id" element={<RedirectToBook />} />
          <Route path="/projects/:id/*" element={<RedirectToBook />} />
          <Route path="/audiobook" element={<Navigate to="/" replace />} />
          <Route path="/audiobook/*" element={<Navigate to="/" replace />} />
          <Route path="/books/new" element={<NewProject />} />
          <Route path="/books/:id" element={<ProjectDetail />} />
          <Route path="/books/:id/chapters/:n" element={<ChapterReader />} />
          <Route path="/books/:id/chapters/:n/correction" element={<CorrectionReview />} />
          <Route path="/books/:id/state" element={<StateView />} />
          <Route path="/books/:id/dashboard" element={<Dashboard />} />
          <Route path="/books/:id/audiobook" element={<BookAudiobook />} />
          <Route path="/books/:id/audiobook/ep/:ep" element={<AudiobookEpisode />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/eval" element={<Evaluation />} />
          <Route path="/eval/:taskId" element={<EvaluationReport />} />
          <Route path="/audit" element={<Audit />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);

function RedirectToBook() {
  const { id } = useParams();
  return <Navigate to={`/books/${id}`} replace />;
}
