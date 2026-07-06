import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  X,
  Rocket,
  Check,
  AlertTriangle,
  AlertCircle,
  Ban,
  ChevronDown,
  ChevronRight,
  Clock,
  Play,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import {
  FUNNEL_EXECUTION_STATUSES,
  type FunnelExecution,
  type FunnelExecutionStatus,
  type FunnelStepResult,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import {
  useFunnelExecutionsQuery,
  useFunnelStatsQuery,
  useCancelExecutionMutation,
  useProductsQuery,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import './Dispatches.css';

const statusIcon = (status: FunnelExecutionStatus, size = 14) => {
  switch (status) {
    case 'running':
      return <Play size={size} />;
    case 'completed':
      return <CheckCircle2 size={size} />;
    case 'cancelled':
      return <Ban size={size} />;
    case 'failed':
      return <XCircle size={size} />;
    default:
      return null;
  }
};

const stepResultIcon = (result: FunnelStepResult | undefined, size = 14) => {
  if (!result) return <Clock size={size} className="dispatch-step-pending" />;
  switch (result.status) {
    case 'sent':
      return <CheckCircle2 size={size} className="dispatch-step-sent" />;
    case 'failed':
      return <XCircle size={size} className="dispatch-step-failed" />;
    case 'skipped':
      return <AlertTriangle size={size} className="dispatch-step-skipped" />;
    default:
      return <Clock size={size} className="dispatch-step-pending" />;
  }
};

const formatDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

export function Dispatches() {
  const { t } = useTranslation();
  useDocumentTitle(t('dispatches.title'));
  const { canWrite } = useRole();

  const [productFilter, setProductFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<FunnelExecutionStatus | ''>('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<FunnelExecution | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const queryParams = useMemo(
    () => ({
      ...(productFilter ? { productId: productFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    }),
    [productFilter, statusFilter],
  );

  const {
    data: executions = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useFunnelExecutionsQuery(queryParams);
  const { data: stats } = useFunnelStatsQuery();
  const { data: products = [] } = useProductsQuery();
  const cancelMutation = useCancelExecutionMutation();

  const productSteps = useMemo(() => {
    const map = new Map<string, { type: string; delayMinutes: number }[]>();
    for (const p of products) {
      map.set(
        p.id,
        p.steps.map(s => ({ type: s.type, delayMinutes: s.delayMinutes })),
      );
    }
    return map;
  }, [products]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancelMutation.mutateAsync(cancelTarget.id);
      setCancelTarget(null);
      setToast({ type: 'success', message: t('dispatches.toasts.cancelled') });
    } catch (err) {
      setToast({
        type: 'error',
        message: t('dispatches.toasts.cancelFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      });
    }
  };

  if (isLoading) {
    return (
      <div
        className="dispatches-page"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="dispatches-page">
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
          <button className="toast-close" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      <PageHeader
        title={t('dispatches.title')}
        subtitle={t('dispatches.subtitle')}
        actions={
          <button className="btn-secondary" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={16} className={isFetching ? 'animate-spin' : undefined} />
            {t('common.refresh')}
          </button>
        }
      />

      <div className="dispatch-stats">
        <div className="dispatch-stat">
          <span className="dispatch-stat-icon running">
            <Play size={18} />
          </span>
          <div className="dispatch-stat-body">
            <span className="dispatch-stat-value">{stats?.running ?? 0}</span>
            <span className="dispatch-stat-label">{t('dispatches.stats.running')}</span>
          </div>
        </div>
        <div className="dispatch-stat">
          <span className="dispatch-stat-icon completed">
            <CheckCircle2 size={18} />
          </span>
          <div className="dispatch-stat-body">
            <span className="dispatch-stat-value">{stats?.completedToday ?? 0}</span>
            <span className="dispatch-stat-label">{t('dispatches.stats.completedToday')}</span>
          </div>
        </div>
        <div className="dispatch-stat">
          <span className="dispatch-stat-icon failed">
            <XCircle size={18} />
          </span>
          <div className="dispatch-stat-body">
            <span className="dispatch-stat-value">{stats?.failedToday ?? 0}</span>
            <span className="dispatch-stat-label">{t('dispatches.stats.failedToday')}</span>
          </div>
        </div>
      </div>

      <div className="dispatch-filters">
        <select value={productFilter} onChange={e => setProductFilter(e.target.value)}>
          <option value="">{t('dispatches.allProducts')}</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as FunnelExecutionStatus | '')}
        >
          <option value="">{t('dispatches.allStatuses')}</option>
          {FUNNEL_EXECUTION_STATUSES.map(s => (
            <option key={s} value={s}>
              {t(`dispatches.statuses.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {isError && (
        <div className="error-banner" role="alert">
          <AlertCircle size={20} />
          <span className="error-banner-text">{t('dashboard.loadError')}</span>
        </div>
      )}

      {executions.length === 0 ? (
        <div className="empty-table-state">
          <Rocket size={48} strokeWidth={1} />
          <h3>{t('dispatches.empty.title')}</h3>
          <p>{t('dispatches.empty.description')}</p>
        </div>
      ) : (
        <div className="dispatch-list">
          {executions.map(exec => {
            const isOpen = expanded === exec.id;
            const steps = productSteps.get(exec.productId) ?? [];
            const totalSteps = exec.totalSteps || steps.length || exec.stepResults.length;
            return (
              <div key={exec.id} className="dispatch-card">
                <button
                  className="dispatch-card-header"
                  onClick={() => setExpanded(isOpen ? null : exec.id)}
                >
                  <span className="dispatch-chevron">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                  <div className="dispatch-main">
                    <span className="dispatch-customer">{exec.customerName || exec.customerPhone}</span>
                    <span className="dispatch-product">{exec.productName ?? t('dispatches.unknownProduct')}</span>
                  </div>
                  <span className={`source-badge source-${exec.source}`}>
                    {t(`dispatches.sources.${exec.source}`)}
                  </span>
                  <span className="dispatch-progress">
                    {Math.min(exec.currentStepIndex, totalSteps)}/{totalSteps}
                  </span>
                  <span className={`status-badge status-${exec.status}`}>
                    {statusIcon(exec.status)}
                    {t(`dispatches.statuses.${exec.status}`)}
                  </span>
                </button>

                {isOpen && (
                  <div className="dispatch-card-body">
                    <div className="dispatch-detail-grid">
                      <span className="dispatch-detail-label">{t('dispatches.customerPhone')}</span>
                      <span className="dispatch-detail-value">{exec.customerPhone}</span>
                      <span className="dispatch-detail-label">{t('dispatches.startedAt')}</span>
                      <span className="dispatch-detail-value">{formatDateTime(exec.createdAt)}</span>
                      {exec.status === 'running' && (
                        <>
                          <span className="dispatch-detail-label">{t('dispatches.nextStepAt')}</span>
                          <span className="dispatch-detail-value">{formatDateTime(exec.nextStepAt)}</span>
                        </>
                      )}
                      {exec.completedAt && (
                        <>
                          <span className="dispatch-detail-label">{t('dispatches.completedAt')}</span>
                          <span className="dispatch-detail-value">{formatDateTime(exec.completedAt)}</span>
                        </>
                      )}
                    </div>

                    <div className="dispatch-timeline">
                      {Array.from({ length: totalSteps }).map((_, i) => {
                        const result = exec.stepResults[i];
                        const step = steps[i];
                        return (
                          <div key={i} className="dispatch-step">
                            <span className="dispatch-step-icon">{stepResultIcon(result)}</span>
                            <span className="dispatch-step-title">
                              {t('dispatches.stepN', { n: i + 1 })}
                              {step ? ` · ${t(`products.stepTypes.${step.type}`)}` : ''}
                            </span>
                            <span className="dispatch-step-status">
                              {result
                                ? t(`dispatches.stepResults.${result.status}`)
                                : t('dispatches.stepResults.pending')}
                            </span>
                            {result?.sentAt && (
                              <span className="dispatch-step-time">{formatDateTime(result.sentAt)}</span>
                            )}
                            {result?.error && <span className="dispatch-step-error">{result.error}</span>}
                          </div>
                        );
                      })}
                    </div>

                    {canWrite && exec.status === 'running' && (
                      <div className="dispatch-card-actions">
                        <button className="btn-danger" onClick={() => setCancelTarget(exec)}>
                          <Ban size={16} />
                          {t('dispatches.cancel')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {cancelTarget && (
        <div className="modal-overlay" onClick={() => setCancelTarget(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('dispatches.cancelTitle')}</h2>
              <button className="btn-icon" onClick={() => setCancelTarget(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>
                {t('dispatches.cancelConfirm', {
                  name: cancelTarget.customerName || cancelTarget.customerPhone,
                })}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setCancelTarget(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn-danger" onClick={handleCancel} disabled={cancelMutation.isPending}>
                {cancelMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : t('dispatches.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
