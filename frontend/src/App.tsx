import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Products } from './pages/Products';
import { ProductDetail } from './pages/ProductDetail';
import { Studio } from './pages/Studio';
import { Pins, Queue } from './pages/Pins';
import { Boards, Analytics } from './pages/BoardsAnalytics';
import { Settings } from './pages/Settings';

export function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/pins" element={<Pins />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/published" element={<Pins statusFilter="published" />} />
          <Route path="/boards" element={<Boards />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
