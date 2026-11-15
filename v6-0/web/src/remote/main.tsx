import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { Remote } from './Remote.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Remote />
  </StrictMode>,
)
