import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration } from 'react-router';
import './styles/global.css';
import { LiveProvider } from './lib/live';
import { ToastProvider } from './components/Toast';
import { StorePage } from './pages/StorePage';
import { ModelPage } from './pages/ModelPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrderPage } from './pages/OrderPage';
import { TermsPage } from './pages/TermsPage';
import { NotFound } from './pages/NotFound';

// Painel interno carregado sob demanda: não pesa para quem só assiste à live.
const AdminApp = lazy(() => import('./admin/AdminApp'));

function PublicRoot() {
  return (
    <LiveProvider>
      <ScrollRestoration />
      <Outlet />
    </LiveProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <PublicRoot />,
    children: [
      { path: '/', element: <StorePage /> },
      { path: '/motos/:slug', element: <ModelPage /> },
      { path: '/motos/:slug/voucher', element: <CheckoutPage /> },
      { path: '/pedido/:code', element: <OrderPage /> },
      { path: '/termo-do-voucher', element: <TermsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    path: '/painel/*',
    element: (
      <Suspense fallback={<div className="skeleton" style={{ height: '100vh' }} />}>
        <AdminApp />
      </Suspense>
    ),
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>,
);
