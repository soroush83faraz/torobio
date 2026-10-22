import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { PlanSummaryCard } from '../components/PlanSummaryCard';
import { t } from '../copy/fa';
import { recentPlans, usePlans } from '../store/plans';
import { useUi } from '../store/ui';

/** «ادامه‌ی برنامه»: up to 5 recent plans. */
export function ResumeSheet() {
  const open = useUi((s) => s.resumeOpen);
  const setOpen = useUi((s) => s.setResume);
  const plans = usePlans((s) => s.plans);
  const navigate = useNavigate();
  const recent = recentPlans(plans, 5);
  const close = () => setOpen(false);
  return (
    <BottomSheet
      open={open}
      onClose={close}
      title={t.header.recentTitle}
      footer={
        <Button
          variant="secondary"
          block
          icon="plus"
          onClick={() => {
            close();
            navigate('/');
          }}
        >
          {t.header.newPlan}
        </Button>
      }
    >
      {recent.length === 0 ? (
        <p className="py-6 text-center text-ink-soft">{t.header.resumeEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {recent.map((p) => (
            <li key={p.id}>
              <PlanSummaryCard plan={p} onNavigate={close} />
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}
