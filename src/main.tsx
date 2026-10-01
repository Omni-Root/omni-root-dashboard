import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { aplicarTemaSalvo } from './components/ThemeToggle';
import { aplicarEscalaSalva } from './tamanhoTexto';
import './estilos/index.css';

// Aplica o tema e o tamanho do texto escolhidos ANTES de renderizar, para a
// página não piscar (vale inclusive para a tela de login).
aplicarTemaSalvo();
aplicarEscalaSalva();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
