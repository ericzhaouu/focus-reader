import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setDocumentLocale } from '../lib/i18n';
import '../styles/pages.css';
import '../styles/arcade.css';

setDocumentLocale('readerPageTitle');

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
