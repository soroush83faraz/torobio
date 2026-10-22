import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState } from '../components/States';
import { toast } from '../components/Toast';
import { t } from '../copy/fa';
import { usePlans } from '../store/plans';
import { decodeShare } from '../store/share';

/** `#/s/<data>`: opening a share link imports a COPY and replaces itself with the plan route. */
export function ShareImport() {
  const { data = '' } = useParams();
  const navigate = useNavigate();
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const decoded = decodeShare(decodeURIComponent(data));
    if (!decoded) {
      setBroken(true);
      return;
    }
    const id = usePlans.getState().importCopy(decoded);
    toast(t.workspace.share.imported);
    navigate(`/plan/${id}`, { replace: true });
  }, [data, navigate]);

  if (broken) {
    return (
      <div className="page py-8">
        <EmptyState title={t.workspace.share.broken} icon="link" tone="danger">
          <Button variant="primary" onClick={() => navigate('/', { replace: true })}>
            {t.workspace.goHome}
          </Button>
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="page py-8">
      <SkeletonCards count={2} />
    </div>
  );
}
