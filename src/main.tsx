import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { aplicarTemaSalvo } from './components/ThemeToggle';
import './theme.css';

// Aplica o tema escolhido ANTES de renderizar, para a página não piscar no
// tema errado (vale inclusive para a tela de login).
aplicarTemaSalvo();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
