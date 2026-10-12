import { RouterProvider, createHashRouter } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import TopicPage from './pages/Topic';
import ExamPage from './pages/Exam';
import { CompaniesPage, CompanyQuestionPage } from './pages/Companies';
import SettingsPage from './pages/Settings';
import { PracticePage, WeakAreasPage } from './pages/WeakAreas';
import { resumeLocation } from './lib/uiPrefs';

// On a fresh start at the dashboard URL, reopen the page the user was last reading.
// Deep links (any other hash) are respected as-is.
const resume = resumeLocation();
if (resume && ['', '#', '#/'].includes(window.location.hash)) {
  window.history.replaceState(null, '', `#${resume}`);
}

const router = createHashRouter([
  {
    element: <Layout />,
    errorElement: (
      <div className="page narrow" style={{ padding: 40 }}>
        <h1>Something went wrong on this page</h1>
        <p className="muted">Your progress is safe. It's stored in this browser.</p>
        <a className="btn btn-primary" href="#/">
          Back to dashboard
        </a>
      </div>
    ),
    children: [
      { index: true, element: <Home /> },
      { path: 'topic/:id', element: <TopicPage /> },
      { path: 'topic/:id/exam', element: <ExamPage /> },
      { path: 'companies', element: <CompaniesPage /> },
      { path: 'companies/:qid', element: <CompanyQuestionPage /> },
      { path: 'weak-areas', element: <WeakAreasPage /> },
      { path: 'practice', element: <PracticePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Home /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
