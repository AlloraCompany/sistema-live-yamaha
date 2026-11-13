import { Link } from 'react-router';
import { StoreLayout } from '../components/Layout';

export function NotFound() {
  return (
    <StoreLayout>
      <div className="empty" style={{ marginTop: 24 }}>
        <p style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>Página não encontrada</p>
        <p style={{ marginBottom: 16 }}>O link pode estar errado ou a moto saiu da live.</p>
        <Link className="btn btn--primary" to="/">
          Voltar à live
        </Link>
      </div>
    </StoreLayout>
  );
}
