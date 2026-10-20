import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Kept as a public runtime module so the original document and React load the
// exact same implementation, without a second bundled navigation definition.
const sharedModule = '/shared/core.js';
void import(/* @vite-ignore */ sharedModule).catch(() => {
  const notice = document.createElement('p');
  notice.setAttribute('role', 'alert');
  notice.textContent = '导航组件未能读取，请重新载入页面。';
  document.getElementById('root')?.prepend(notice);
});
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
