import { Routes, Route, Navigate } from 'react-router-dom'
import Layout             from './components/Layout'
import Dashboard          from './pages/Dashboard'
import Jobs               from './pages/Jobs'
import JobDetail          from './pages/JobDetail'
import Candidates         from './pages/Candidates'
import CandidateProfile   from './pages/CandidateProfile'
import RecruiterWorkflow  from './pages/RecruiterWorkflow'
import Analytics          from './pages/Analytics'
import CandidatePortal    from './pages/CandidatePortal'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index                  element={<Dashboard />}         />
        <Route path="jobs"            element={<Jobs />}              />
        <Route path="jobs/:id"        element={<JobDetail />}         />
        <Route path="candidates"      element={<Candidates />}        />
        <Route path="candidates/:id"  element={<CandidateProfile />}  />
        <Route path="workflow"        element={<RecruiterWorkflow />}  />
        <Route path="analytics"       element={<Analytics />}         />
        <Route path="portal"          element={<CandidatePortal />}   />
        <Route path="*"               element={<Navigate to="/" />}   />
      </Route>
    </Routes>
  )
}
