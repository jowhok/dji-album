import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme, resolveTheme, getThemeMode } from './theme'
import './styles.css'

// 首帧就应用已保存的主题，避免浅色主题启动时闪一下深色
applyTheme(resolveTheme(getThemeMode()))

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
