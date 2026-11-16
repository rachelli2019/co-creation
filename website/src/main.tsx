import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import StudyAccess from './StudyAccess'
import LocalPreview from './LocalPreview.tsx'
import './index.css'

const params = new URLSearchParams(window.location.search)
const preview = import.meta.env.DEV && params.get('preview') !== 'false' && params.get('task') !== '2'
const Root = preview ? LocalPreview : () => <StudyAccess walkthrough={<LocalPreview />}><App /></StudyAccess>

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Root /></React.StrictMode>,
)
