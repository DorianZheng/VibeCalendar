import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { Toaster } from 'react-hot-toast';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
    <Toaster 
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: '#ffffff',
          color: '#374151',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          fontSize: '14px',
          fontWeight: '400',
          padding: '12px 16px',
        },
        success: {
          duration: 3000,
          style: {
            background: '#ffffff',
            color: '#374151',
            border: '1px solid #e5e7eb',
            borderLeft: '4px solid #10b981',
          },
          iconTheme: {
            primary: '#10b981',
            secondary: '#ffffff',
          },
        },
        error: {
          duration: 5000,
          style: {
            background: '#ffffff',
            color: '#374151',
            border: '1px solid #e5e7eb',
            borderLeft: '4px solid #ef4444',
          },
          iconTheme: {
            primary: '#ef4444',
            secondary: '#ffffff',
          },
        },
        loading: {
          style: {
            background: '#ffffff',
            color: '#374151',
            border: '1px solid #e5e7eb',
            borderLeft: '4px solid #3b82f6',
          },
          iconTheme: {
            primary: '#3b82f6',
            secondary: '#ffffff',
          },
        },
      }}
    />
  </React.StrictMode>
); 