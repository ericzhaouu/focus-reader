import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setDocumentLocale } from '../lib/i18n';
import '../styles/pages.css';

setDocumentLocale('optionsPageTitle');

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
